import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import prisma from "../db.server";
import { assetLimit } from "../lib/plans";
import { authenticate } from "../shopify.server";

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

  return {
    plan: settings.plan,
    limit: assetLimit(settings.plan),
    assets: assets.map((asset) => ({
      id: asset.id,
      assetNumber: asset.assetNumber,
      title: asset.title,
      status: asset.status,
      dailyRateCents: asset.dailyRateCents,
      currency: asset.currency,
      active: asset.active,
    })),
  };
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export default function EquipmentPage() {
  const { assets, limit, plan } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Equipment">
      <s-section heading="Inventory">
        <s-paragraph>
          {assets.filter((asset) => asset.active).length} active asset(s) · {plan} plan · Limit: {limit ?? "Unlimited"}
        </s-paragraph>

        {assets.length === 0 ? (
          <s-paragraph>
            No equipment yet. The RentalFlow data model is ready; equipment creation is the next MVP step.
          </s-paragraph>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10 }}>Asset #</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Equipment</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Status</th>
                  <th style={{ textAlign: "right", padding: 10 }}>Daily rate</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id} style={{ borderTop: "1px solid #e3e3e3" }}>
                    <td style={{ padding: 10 }}>{asset.assetNumber}</td>
                    <td style={{ padding: 10 }}>{asset.title}</td>
                    <td style={{ padding: 10 }}>{asset.active ? asset.status : "INACTIVE"}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>
                      {money(asset.dailyRateCents, asset.currency)}
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
