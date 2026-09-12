import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import prisma from "../db.server";
import { hasFeature } from "../lib/plans";
import { authenticate } from "../shopify.server";

const PAYMENT_METHODS = ["CASH", "CARD", "E_TRANSFER", "OTHER"] as const;

function textValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function parseMoneyToCents(value: FormDataEntryValue | null) {
  const normalized = textValue(value).replace(",", ".");
  if (!normalized) return null;

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function paymentNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `P-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function methodLabel(method: string) {
  return method.replaceAll("_", " ");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, reservations] = await Promise.all([
    prisma.shopSettings.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
    prisma.reservation.findMany({
      where: { shop, status: { not: "CANCELLED" } },
      orderBy: { startDateTime: "desc" },
      include: {
        payments: {
          orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
          take: 25,
        },
      },
      take: 100,
    }),
  ]);

  return {
    plan: settings.plan,
    paymentsEnabled: hasFeature(settings.plan, "PAYMENTS"),
    reservations: reservations.map((reservation) => {
      const completedPayments = reservation.payments.filter(
        (payment) => payment.status === "COMPLETED",
      );
      const paidCents = completedPayments.reduce(
        (sum, payment) => sum + payment.amountCents,
        0,
      );
      const balanceDueCents = Math.max(0, reservation.totalCents - paidCents);

      return {
        id: reservation.id,
        reservationNumber: reservation.reservationNumber,
        customerName: reservation.customerName,
        startDateTime: reservation.startDateTime.toISOString(),
        status: reservation.status,
        totalCents: reservation.totalCents,
        paidCents,
        balanceDueCents,
        currency: reservation.currency,
        payments: reservation.payments.map((payment) => ({
          id: payment.id,
          paymentNumber: payment.paymentNumber,
          paymentType: payment.paymentType,
          method: payment.method,
          status: payment.status,
          amountCents: payment.amountCents,
          currency: payment.currency,
          paymentDate: payment.paymentDate?.toISOString() || null,
          reference: payment.reference || "",
          notes: payment.notes || "",
        })),
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = textValue(formData.get("intent"));

  if (intent !== "record") {
    return { ok: false, error: "Unknown payment action." };
  }

  const settings = await prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  if (!hasFeature(settings.plan, "PAYMENTS")) {
    return {
      ok: false,
      error: "Payment tracking is available on Starter, Business and Pro plans.",
    };
  }

  const reservationId = textValue(formData.get("reservationId"));
  const amountCents = parseMoneyToCents(formData.get("amount"));
  const method = textValue(formData.get("method"));
  const reference = textValue(formData.get("reference")) || null;
  const notes = textValue(formData.get("notes")) || null;

  if (!reservationId) return { ok: false, error: "Select a reservation." };
  if (amountCents === null) return { ok: false, error: "Enter a valid payment amount." };
  if (!PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) {
    return { ok: false, error: "Select a valid payment method." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id: reservationId, shop },
        include: {
          payments: {
            where: { status: "COMPLETED" },
            select: { amountCents: true },
          },
        },
      });

      if (!reservation) throw new Error("RESERVATION_NOT_FOUND");
      if (reservation.status === "CANCELLED") throw new Error("RESERVATION_CANCELLED");

      const paidCents = reservation.payments.reduce(
        (sum, payment) => sum + payment.amountCents,
        0,
      );
      const balanceDueCents = Math.max(0, reservation.totalCents - paidCents);

      if (balanceDueCents <= 0) throw new Error("PAID_IN_FULL");
      if (amountCents > balanceDueCents) {
        throw new Error(`OVERPAY:${balanceDueCents}`);
      }

      const number = paymentNumber();
      const remainingBalanceCents = balanceDueCents - amountCents;

      await tx.payment.create({
        data: {
          shop,
          reservationId: reservation.id,
          paymentNumber: number,
          paymentType: "PAYMENT",
          method,
          status: "COMPLETED",
          amountCents,
          currency: reservation.currency,
          paymentDate: new Date(),
          reference,
          remainingBalanceCents,
          notes,
        },
      });

      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          balanceDueCents: remainingBalanceCents,
          paymentMode: method,
          activity: {
            create: {
              shop,
              action: "PAYMENT_RECORDED",
              description: `${number} recorded for ${money(amountCents, reservation.currency)}.`,
            },
          },
        },
      });

      return {
        paymentNumber: number,
        reservationNumber: reservation.reservationNumber,
        amountCents,
        remainingBalanceCents,
        currency: reservation.currency,
      };
    });

    return {
      ok: true,
      message: `${result.paymentNumber} recorded on ${result.reservationNumber} for ${money(result.amountCents, result.currency)}. Balance: ${money(result.remainingBalanceCents, result.currency)}.`,
    };
  } catch (error) {
    console.error("Payment recording failed", error);
    const message = error instanceof Error ? error.message : "";

    if (message === "RESERVATION_NOT_FOUND") {
      return { ok: false, error: "The reservation could not be found." };
    }
    if (message === "RESERVATION_CANCELLED") {
      return { ok: false, error: "Payments cannot be added to a cancelled reservation." };
    }
    if (message === "PAID_IN_FULL") {
      return { ok: false, error: "This reservation is already paid in full." };
    }
    if (message.startsWith("OVERPAY:")) {
      const balance = Number(message.slice("OVERPAY:".length));
      return {
        ok: false,
        error: `The payment is greater than the remaining balance of ${money(balance, settings.currency)}.`,
      };
    }

    return { ok: false, error: "Could not record the payment. Please try again." };
  }
};

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

export default function PaymentsPage() {
  const { plan, paymentsEnabled, reservations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const outstanding = reservations.filter((reservation) => reservation.balanceDueCents > 0);

  return (
    <s-page heading="Payments">
      {actionData?.ok === false && (
        <s-section heading="Payment action failed">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-section>
      )}

      {actionData?.ok === true && (
        <s-section heading="Payment recorded">
          <s-paragraph>{actionData.message}</s-paragraph>
        </s-section>
      )}

      <s-section heading="Payment tracking">
        <s-paragraph>
          Current plan: {plan}. Payment tracking is available on Starter, Business and Pro plans.
        </s-paragraph>
        {!paymentsEnabled && (
          <s-paragraph>
            Upgrade the RentalFlow plan to record payments. Existing reservation totals remain visible below.
          </s-paragraph>
        )}
      </s-section>

      <s-section heading={`Outstanding reservations (${outstanding.length})`}>
        {outstanding.length === 0 ? (
          <s-paragraph>No outstanding reservation balances.</s-paragraph>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {outstanding.map((reservation) => (
              <div
                key={reservation.id}
                style={{
                  border: "1px solid #e3e3e3",
                  borderRadius: 10,
                  padding: 14,
                  background: "white",
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {reservation.reservationNumber} · {reservation.customerName}
                </div>
                <div style={{ marginTop: 6, fontSize: 13 }}>
                  Rental date: {dateTime(reservation.startDateTime)} · Total: {money(reservation.totalCents, reservation.currency)} · Paid: {money(reservation.paidCents, reservation.currency)} · <strong>Balance: {money(reservation.balanceDueCents, reservation.currency)}</strong>
                </div>

                {paymentsEnabled && (
                  <Form method="post" style={{ marginTop: 12 }}>
                    <input type="hidden" name="intent" value="record" />
                    <input type="hidden" name="reservationId" value={reservation.id} />
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                        gap: 10,
                        alignItems: "end",
                      }}
                    >
                      <label style={labelStyle}>
                        Amount ({reservation.currency})
                        <input
                          name="amount"
                          required
                          inputMode="decimal"
                          defaultValue={(reservation.balanceDueCents / 100).toFixed(2)}
                          style={inputStyle}
                        />
                      </label>

                      <label style={labelStyle}>
                        Method
                        <select name="method" defaultValue="CARD" style={inputStyle}>
                          <option value="CARD">Card</option>
                          <option value="CASH">Cash</option>
                          <option value="E_TRANSFER">E-transfer</option>
                          <option value="OTHER">Other</option>
                        </select>
                      </label>

                      <label style={labelStyle}>
                        Reference
                        <input name="reference" placeholder="Optional" style={inputStyle} />
                      </label>

                      <button type="submit" style={buttonStyle}>Record payment</button>
                    </div>

                    <label style={{ ...labelStyle, marginTop: 10 }}>
                      Notes
                      <input name="notes" placeholder="Optional" style={inputStyle} />
                    </label>
                  </Form>
                )}
              </div>
            ))}
          </div>
        )}
      </s-section>

      <s-section heading="Payment history">
        {reservations.every((reservation) => reservation.payments.length === 0) ? (
          <s-paragraph>No payments recorded yet.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10 }}>Payment</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Reservation</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Customer</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Date</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Method</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Reference</th>
                  <th style={{ textAlign: "right", padding: 10 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {reservations.flatMap((reservation) =>
                  reservation.payments.map((payment) => (
                    <tr key={payment.id} style={{ borderTop: "1px solid #e3e3e3" }}>
                      <td style={{ padding: 10 }}>{payment.paymentNumber}</td>
                      <td style={{ padding: 10 }}>{reservation.reservationNumber}</td>
                      <td style={{ padding: 10 }}>{reservation.customerName}</td>
                      <td style={{ padding: 10 }}>{dateTime(payment.paymentDate)}</td>
                      <td style={{ padding: 10 }}>{methodLabel(payment.method)}</td>
                      <td style={{ padding: 10 }}>{payment.reference || "—"}</td>
                      <td style={{ padding: 10, textAlign: "right" }}>
                        {money(payment.amountCents, payment.currency)}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}
