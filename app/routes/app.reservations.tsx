import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import prisma from "../db.server";
import { hasFeature } from "../lib/plans";
import { authenticate } from "../shopify.server";

function textValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function parseNonNegativeInt(value: FormDataEntryValue | null) {
  const raw = textValue(value);
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseDateTime(value: FormDataEntryValue | null) {
  const raw = textValue(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function billableDays(start: Date, end: Date) {
  const milliseconds = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(milliseconds / 86_400_000));
}

function customerDisplayName(customer: {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}) {
  return (
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
    customer.companyName ||
    "Unnamed customer"
  );
}

function reservationNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `R-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, customers, assets, reservations] = await Promise.all([
    prisma.shopSettings.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
    prisma.customer.findMany({
      where: { shop, active: true },
      orderBy: [{ customerNumber: "asc" }],
      take: 250,
    }),
    prisma.asset.findMany({
      where: { shop, active: true, status: "AVAILABLE" },
      orderBy: [{ assetNumber: "asc" }],
      take: 250,
    }),
    prisma.reservation.findMany({
      where: { shop },
      include: {
        items: {
          select: {
            assetNumber: true,
            assetTitle: true,
          },
          orderBy: { assetNumber: "asc" },
        },
      },
      orderBy: { startDateTime: "asc" },
      take: 250,
    }),
  ]);

  return {
    settings: {
      plan: settings.plan,
      currency: settings.currency,
      customerDiscountEnabled: hasFeature(settings.plan, "CUSTOMER_DISCOUNT"),
    },
    customers: customers.map((customer) => ({
      id: customer.id,
      customerNumber: customer.customerNumber,
      displayName: customerDisplayName(customer),
      discountPercent: customer.discountPercent,
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      assetNumber: asset.assetNumber,
      title: asset.title,
      dailyRateCents: asset.dailyRateCents,
      currency: asset.currency,
    })),
    reservations: reservations.map((reservation) => ({
      id: reservation.id,
      reservationNumber: reservation.reservationNumber,
      customerName: reservation.customerName,
      startDateTime: reservation.startDateTime.toISOString(),
      endDateTime: reservation.endDateTime.toISOString(),
      status: reservation.status,
      totalCents: reservation.totalCents,
      currency: reservation.currency,
      assets: reservation.items.map((item) => `${item.assetNumber} · ${item.assetTitle}`),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = textValue(formData.get("intent"));

  if (intent !== "create") {
    return { ok: false, error: "Unknown reservation action." };
  }

  const customerId = textValue(formData.get("customerId"));
  const assetIds = Array.from(
    new Set(formData.getAll("assetIds").map((value) => textValue(value)).filter(Boolean)),
  );
  const startDateTime = parseDateTime(formData.get("startDateTime"));
  const endDateTime = parseDateTime(formData.get("endDateTime"));
  const bufferBeforeHours = parseNonNegativeInt(formData.get("bufferBeforeHours"));
  const bufferAfterHours = parseNonNegativeInt(formData.get("bufferAfterHours"));
  const notes = textValue(formData.get("notes")) || null;

  if (!customerId) return { ok: false, error: "Select a customer." };
  if (assetIds.length === 0) return { ok: false, error: "Select at least one piece of equipment." };
  if (!startDateTime || !endDateTime) return { ok: false, error: "Enter valid start and end dates." };
  if (endDateTime <= startDateTime) return { ok: false, error: "The end date must be after the start date." };
  if (bufferBeforeHours === null || bufferAfterHours === null) {
    return { ok: false, error: "Buffers must be whole numbers greater than or equal to 0." };
  }

  const blockedStartDateTime = new Date(startDateTime.getTime() - bufferBeforeHours * 3_600_000);
  const blockedEndDateTime = new Date(endDateTime.getTime() + bufferAfterHours * 3_600_000);
  const lockToken = randomUUID();
  const lockExpiresAt = new Date(Date.now() + 30_000);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const settings = await tx.shopSettings.upsert({
        where: { shop },
        update: {},
        create: { shop },
      });

      const customer = await tx.customer.findFirst({
        where: { id: customerId, shop, active: true },
      });
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      const assets = await tx.asset.findMany({
        where: {
          id: { in: assetIds },
          shop,
          active: true,
          status: "AVAILABLE",
        },
        orderBy: { assetNumber: "asc" },
      });
      if (assets.length !== assetIds.length) throw new Error("ASSET_NOT_FOUND");

      await tx.bookingLock.deleteMany({
        where: {
          shop,
          assetId: { in: assetIds },
          expiresAt: { lte: new Date() },
        },
      });

      for (const asset of assets) {
        try {
          await tx.bookingLock.create({
            data: {
              shop,
              assetId: asset.id,
              lockToken,
              expiresAt: lockExpiresAt,
            },
          });
        } catch {
          throw new Error(`LOCKED:${asset.assetNumber}`);
        }
      }

      const conflicts = await tx.reservationItem.findMany({
        where: {
          shop,
          assetId: { in: assetIds },
          status: { not: "CANCELLED" },
          blockedStartDateTime: { lt: blockedEndDateTime },
          blockedEndDateTime: { gt: blockedStartDateTime },
        },
        select: {
          assetNumber: true,
          assetTitle: true,
          reservation: {
            select: { reservationNumber: true },
          },
        },
      });

      if (conflicts.length > 0) {
        const conflictText = conflicts
          .map((conflict) => `${conflict.assetNumber} (${conflict.reservation.reservationNumber})`)
          .join(", ");
        throw new Error(`CONFLICT:${conflictText}`);
      }

      const days = billableDays(startDateTime, endDateTime);
      const subtotalCents = assets.reduce(
        (sum, asset) => sum + asset.dailyRateCents * days,
        0,
      );
      const customerDiscountPercent = hasFeature(settings.plan, "CUSTOMER_DISCOUNT")
        ? customer.discountPercent
        : 0;
      const discountCents = Math.round(subtotalCents * (customerDiscountPercent / 100));
      const preTaxTotalCents = Math.max(0, subtotalCents - discountCents);
      const totalCents = preTaxTotalCents;
      const number = reservationNumber();
      const customerName = customerDisplayName(customer);

      const reservation = await tx.reservation.create({
        data: {
          shop,
          reservationNumber: number,
          customerId: customer.id,
          customerName,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          startDateTime,
          endDateTime,
          bufferBeforeHours,
          bufferAfterHours,
          status: "CONFIRMED",
          workflowStage: "RESERVATION",
          subtotalCents,
          customerDiscountPercent,
          discountCents,
          preTaxTotalCents,
          tax1Rate: 0,
          tax1Cents: 0,
          tax2Rate: 0,
          tax2Cents: 0,
          taxTotalCents: 0,
          totalCents,
          currency: settings.currency,
          amountDueNowCents: 0,
          balanceDueCents: totalCents,
          notes,
          items: {
            create: assets.map((asset) => ({
              shop,
              assetId: asset.id,
              assetNumber: asset.assetNumber,
              assetTitle: asset.title,
              startDateTime,
              endDateTime,
              blockedStartDateTime,
              blockedEndDateTime,
              bufferBeforeHours,
              bufferAfterHours,
              billableDays: days,
              lineTotalCents: asset.dailyRateCents * days,
              pricingMode: "DAILY",
              currency: settings.currency,
              status: "CONFIRMED",
            })),
          },
          activity: {
            create: {
              shop,
              action: "RESERVATION_CREATED",
              description: `Reservation ${number} created for ${customerName}.`,
            },
          },
        },
      });

      await tx.bookingLock.deleteMany({ where: { shop, lockToken } });

      return {
        reservationNumber: reservation.reservationNumber,
        totalCents: reservation.totalCents,
        currency: reservation.currency,
      };
    });

    return {
      ok: true,
      message: `${result.reservationNumber} was created for ${money(result.totalCents, result.currency)}.`,
    };
  } catch (error) {
    console.error("Reservation creation failed", error);
    const message = error instanceof Error ? error.message : "";

    if (message === "CUSTOMER_NOT_FOUND") {
      return { ok: false, error: "The selected customer is no longer available." };
    }
    if (message === "ASSET_NOT_FOUND") {
      return { ok: false, error: "One or more selected assets are no longer available." };
    }
    if (message.startsWith("LOCKED:")) {
      return {
        ok: false,
        error: `${message.slice("LOCKED:".length)} is being reserved by another request. Try again in a few seconds.`,
      };
    }
    if (message.startsWith("CONFLICT:")) {
      return {
        ok: false,
        error: `Reservation conflict: ${message.slice("CONFLICT:".length)} is already booked during that period.`,
      };
    }

    return { ok: false, error: "Could not create the reservation. Please try again." };
  }
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "8px 10px",
  border: "1px solid #c9cccf",
  borderRadius: 6,
  background: "white",
};

const labelStyle = {
  display: "grid",
  gap: 4,
  fontSize: 13,
  fontWeight: 600,
};

const buttonStyle = {
  border: "1px solid #8c9196",
  borderRadius: 6,
  padding: "9px 14px",
  background: "white",
  cursor: "pointer",
};

export default function ReservationsPage() {
  const { settings, customers, assets, reservations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const canCreate = customers.length > 0 && assets.length > 0;

  return (
    <s-page heading="Reservations">
      {actionData?.ok === false && (
        <s-section heading="Could not create reservation">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-section>
      )}

      {actionData?.ok === true && (
        <s-section heading="Reservation created">
          <s-paragraph>{actionData.message}</s-paragraph>
        </s-section>
      )}

      <s-section heading="Create reservation">
        {!canCreate ? (
          <s-paragraph>
            Add at least one active customer and one AVAILABLE piece of equipment before creating a reservation.
          </s-paragraph>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="create" />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
                marginTop: 12,
              }}
            >
              <label style={labelStyle}>
                Customer
                <select name="customerId" required defaultValue="" style={inputStyle}>
                  <option value="" disabled>Select a customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.customerNumber} · {customer.displayName}
                      {settings.customerDiscountEnabled && customer.discountPercent > 0
                        ? ` · ${customer.discountPercent}% discount`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label style={labelStyle}>
                Start
                <input name="startDateTime" type="datetime-local" required style={inputStyle} />
              </label>

              <label style={labelStyle}>
                End
                <input name="endDateTime" type="datetime-local" required style={inputStyle} />
              </label>

              <label style={labelStyle}>
                Buffer before (hours)
                <input name="bufferBeforeHours" type="number" min="0" step="1" defaultValue="0" style={inputStyle} />
              </label>

              <label style={labelStyle}>
                Buffer after (hours)
                <input name="bufferAfterHours" type="number" min="0" step="1" defaultValue="0" style={inputStyle} />
              </label>
            </div>

            <label style={{ ...labelStyle, marginTop: 12 }}>
              Equipment
              <select name="assetIds" multiple required size={Math.min(Math.max(assets.length, 4), 8)} style={inputStyle}>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.assetNumber} · {asset.title} · {money(asset.dailyRateCents, asset.currency)}/day
                  </option>
                ))}
              </select>
              <span style={{ fontWeight: 400 }}>Use Ctrl (Windows) or Cmd (Mac) to select multiple items.</span>
            </label>

            <label style={{ ...labelStyle, marginTop: 12 }}>
              Notes
              <textarea name="notes" rows={3} style={inputStyle} />
            </label>

            <div style={{ marginTop: 12 }}>
              <button type="submit" style={buttonStyle}>Create reservation</button>
            </div>
          </Form>
        )}

        <div style={{ marginTop: 12, fontSize: 13 }}>
          Pricing currently uses daily rates. Customer discounts apply on Business and Pro plans. Taxes and payments are the next billing step.
        </div>
      </s-section>

      <s-section heading={`Rental reservations (${reservations.length})`}>
        {reservations.length === 0 ? (
          <s-paragraph>No reservations yet.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10 }}>Reservation</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Customer</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Equipment</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Start</th>
                  <th style={{ textAlign: "left", padding: 10 }}>End</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Status</th>
                  <th style={{ textAlign: "right", padding: 10 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((reservation) => (
                  <tr key={reservation.id} style={{ borderTop: "1px solid #e3e3e3" }}>
                    <td style={{ padding: 10 }}>{reservation.reservationNumber}</td>
                    <td style={{ padding: 10 }}>{reservation.customerName}</td>
                    <td style={{ padding: 10 }}>{reservation.assets.join(", ")}</td>
                    <td style={{ padding: 10 }}>{dateTime(reservation.startDateTime)}</td>
                    <td style={{ padding: 10 }}>{dateTime(reservation.endDateTime)}</td>
                    <td style={{ padding: 10 }}>{reservation.status}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>
                      {money(reservation.totalCents, reservation.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}
