import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const now = new Date();

  const settingsPromise = prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  const [settings, activeAssets, customers, openReservations, upcomingReservations] =
    await Promise.all([
      settingsPromise,
      prisma.asset.count({ where: { shop, active: true } }),
      prisma.customer.count({ where: { shop, active: true } }),
      prisma.reservation.count({
        where: {
          shop,
          status: { notIn: ["CANCELLED", "COMPLETED"] },
        },
      }),
      prisma.reservation.count({
        where: {
          shop,
          startDateTime: { gte: now },
          status: { notIn: ["CANCELLED", "COMPLETED"] },
        },
      }),
    ]);

  return {
    shop,
    plan: settings.plan,
    activeAssets,
    customers,
    openReservations,
    upcomingReservations,
  };
};

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{
        border: "1px solid #dfe3e8",
        borderRadius: 12,
        padding: 20,
        minWidth: 180,
        flex: "1 1 180px",
        background: "white",
      }}
    >
      <div style={{ fontSize: 13, color: "#616161", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 650 }}>{value}</div>
    </div>
  );
}

export default function Index() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="RentalFlow">
      <s-section heading="Rental operations at a glance">
        <s-paragraph>
          Manage equipment, customers, reservations and availability directly from Shopify Admin.
        </s-paragraph>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginTop: 16,
          }}
        >
          <Metric label="Active equipment" value={data.activeAssets} />
          <Metric label="Active customers" value={data.customers} />
          <Metric label="Open reservations" value={data.openReservations} />
          <Metric label="Upcoming reservations" value={data.upcomingReservations} />
        </div>
      </s-section>

      <s-section heading="Quick access">
        <s-stack direction="inline" gap="base">
          <s-link href="/app/equipment">Equipment</s-link>
          <s-link href="/app/customers">Customers</s-link>
          <s-link href="/app/reservations">Reservations</s-link>
          <s-link href="/app/calendar">Calendar</s-link>
        </s-stack>
      </s-section>

      <s-section heading="Store">
        <s-paragraph>
          {data.shop} · RentalFlow plan: {data.plan}
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
