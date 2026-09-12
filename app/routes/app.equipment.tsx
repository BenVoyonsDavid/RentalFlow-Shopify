import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import prisma from "../db.server";
import { assetLimit } from "../lib/plans";
import { authenticate } from "../shopify.server";

const ASSET_STATUSES = ["AVAILABLE", "MAINTENANCE", "UNAVAILABLE"] as const;

function parseMoneyToCents(value: FormDataEntryValue | null): number | null {
  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");

  if (!normalized) return null;

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;

  return Math.round(amount * 100);
}

function textValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [settings, assets] = await Promise.all([
    prisma.shopSettings.upsert({
      where: { shop },
      update: {},
      create: { shop },
    }),
    prisma.asset.findMany({
      where: { shop },
      orderBy: [{ active: "desc" }, { assetNumber: "asc" }],
      take: 250,
    }),
  ]);

  const activeCount = assets.filter((asset) => asset.active).length;

  return {
    plan: settings.plan,
    limit: assetLimit(settings.plan),
    activeCount,
    currency: settings.currency,
    assets: assets.map((asset) => ({
      id: asset.id,
      assetNumber: asset.assetNumber,
      title: asset.title,
      status: asset.status,
      dailyRateCents: asset.dailyRateCents,
      currency: asset.currency,
      serialNumber: asset.serialNumber,
      active: asset.active,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = textValue(formData.get("intent"));

  const settings = await prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  const limit = assetLimit(settings.plan);

  try {
    if (intent === "create") {
      const assetNumber = textValue(formData.get("assetNumber"));
      const title = textValue(formData.get("title"));
      const status = textValue(formData.get("status")) || "AVAILABLE";
      const serialNumber = textValue(formData.get("serialNumber")) || null;
      const dailyRateCents = parseMoneyToCents(formData.get("dailyRate"));

      if (!assetNumber || !title) {
        return { ok: false, error: "Asset number and equipment name are required." };
      }

      if (!ASSET_STATUSES.includes(status as (typeof ASSET_STATUSES)[number])) {
        return { ok: false, error: "Invalid equipment status." };
      }

      if (dailyRateCents === null) {
        return { ok: false, error: "Enter a valid daily rate." };
      }

      const activeCount = await prisma.asset.count({ where: { shop, active: true } });
      if (limit !== null && activeCount >= limit) {
        return {
          ok: false,
          error: `Your ${settings.plan} plan allows ${limit} active assets. Upgrade or deactivate an asset before adding another one.`,
        };
      }

      await prisma.asset.create({
        data: {
          shop,
          assetNumber,
          title,
          status,
          dailyRateCents,
          currency: settings.currency,
          serialNumber,
          active: true,
        },
      });

      return { ok: true, message: `${assetNumber} was added.` };
    }

    if (intent === "update") {
      const id = textValue(formData.get("id"));
      const assetNumber = textValue(formData.get("assetNumber"));
      const title = textValue(formData.get("title"));
      const status = textValue(formData.get("status"));
      const serialNumber = textValue(formData.get("serialNumber")) || null;
      const dailyRateCents = parseMoneyToCents(formData.get("dailyRate"));

      const asset = await prisma.asset.findFirst({ where: { id, shop } });
      if (!asset) return { ok: false, error: "Equipment not found." };

      if (!assetNumber || !title) {
        return { ok: false, error: "Asset number and equipment name are required." };
      }

      if (!ASSET_STATUSES.includes(status as (typeof ASSET_STATUSES)[number])) {
        return { ok: false, error: "Invalid equipment status." };
      }

      if (dailyRateCents === null) {
        return { ok: false, error: "Enter a valid daily rate." };
      }

      await prisma.asset.update({
        where: { id },
        data: {
          assetNumber,
          title,
          status,
          dailyRateCents,
          serialNumber,
        },
      });

      return { ok: true, message: `${assetNumber} was updated.` };
    }

    if (intent === "toggle") {
      const id = textValue(formData.get("id"));
      const asset = await prisma.asset.findFirst({ where: { id, shop } });
      if (!asset) return { ok: false, error: "Equipment not found." };

      const nextActive = !asset.active;

      if (nextActive && limit !== null) {
        const activeCount = await prisma.asset.count({ where: { shop, active: true } });
        if (activeCount >= limit) {
          return {
            ok: false,
            error: `Your ${settings.plan} plan allows ${limit} active assets. Deactivate another asset or upgrade first.`,
          };
        }
      }

      await prisma.asset.update({
        where: { id },
        data: { active: nextActive },
      });

      return {
        ok: true,
        message: `${asset.assetNumber} is now ${nextActive ? "active" : "inactive"}.`,
      };
    }

    return { ok: false, error: "Unknown equipment action." };
  } catch (error) {
    console.error("Equipment action failed", error);
    return {
      ok: false,
      error: "Could not save the equipment. Check that the asset number is unique and try again.",
    };
  }
};

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
  padding: "8px 12px",
  background: "white",
  cursor: "pointer",
};

export default function EquipmentPage() {
  const { assets, limit, plan, activeCount, currency } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const atLimit = limit !== null && activeCount >= limit;

  return (
    <s-page heading="Equipment">
      {actionData?.ok === false && (
        <s-section heading="Could not save">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-section>
      )}

      {actionData?.ok === true && (
        <s-section heading="Saved">
          <s-paragraph>{actionData.message}</s-paragraph>
        </s-section>
      )}

      <s-section heading="Add equipment">
        <s-paragraph>
          {activeCount} active asset(s) · {plan} plan · Limit: {limit ?? "Unlimited"}
        </s-paragraph>

        {atLimit ? (
          <s-paragraph>
            Your active equipment limit has been reached. Deactivate an asset or upgrade the RentalFlow plan before adding another one.
          </s-paragraph>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginTop: 16,
                alignItems: "end",
              }}
            >
              <label style={labelStyle}>
                Asset #
                <input name="assetNumber" required placeholder="RF-001" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Equipment name
                <input name="title" required placeholder="20 ft trailer" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Serial number
                <input name="serialNumber" placeholder="Optional" style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Daily rate ({currency})
                <input
                  name="dailyRate"
                  required
                  inputMode="decimal"
                  defaultValue="0.00"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Status
                <select name="status" defaultValue="AVAILABLE" style={inputStyle}>
                  <option value="AVAILABLE">Available</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="UNAVAILABLE">Unavailable</option>
                </select>
              </label>
              <button type="submit" style={buttonStyle}>Add equipment</button>
            </div>
          </Form>
        )}
      </s-section>

      <s-section heading="Inventory">
        {assets.length === 0 ? (
          <s-paragraph>No equipment yet. Add the first asset above.</s-paragraph>
        ) : (
          <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
            {assets.map((asset) => (
              <div
                key={asset.id}
                style={{
                  border: "1px solid #e1e3e5",
                  borderRadius: 8,
                  padding: 14,
                  opacity: asset.active ? 1 : 0.65,
                }}
              >
                <Form method="post">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="id" value={asset.id} />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                      gap: 10,
                      alignItems: "end",
                    }}
                  >
                    <label style={labelStyle}>
                      Asset #
                      <input name="assetNumber" required defaultValue={asset.assetNumber} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Equipment
                      <input name="title" required defaultValue={asset.title} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Serial number
                      <input name="serialNumber" defaultValue={asset.serialNumber ?? ""} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Daily rate
                      <input
                        name="dailyRate"
                        required
                        inputMode="decimal"
                        defaultValue={(asset.dailyRateCents / 100).toFixed(2)}
                        style={inputStyle}
                      />
                    </label>
                    <label style={labelStyle}>
                      Status
                      <select name="status" defaultValue={asset.status} style={inputStyle}>
                        <option value="AVAILABLE">Available</option>
                        <option value="MAINTENANCE">Maintenance</option>
                        <option value="UNAVAILABLE">Unavailable</option>
                      </select>
                    </label>
                    <button type="submit" style={buttonStyle}>Save</button>
                  </div>
                </Form>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    marginTop: 12,
                  }}
                >
                  <span>
                    {asset.active ? "Active" : "Inactive"} · {money(asset.dailyRateCents, asset.currency)} / day
                  </span>
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle" />
                    <input type="hidden" name="id" value={asset.id} />
                    <button type="submit" style={buttonStyle}>
                      {asset.active ? "Deactivate" : "Activate"}
                    </button>
                  </Form>
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}
