import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 45);

  const reservations = await prisma.reservation.findMany({
    where: {
      shop: session.shop,
      startDateTime: { lte: horizon },
      endDateTime: { gte: now },
      status: { notIn: ["CANCELLED", "COMPLETED"] },
    },
    orderBy: { startDateTime: "asc" },
    include: {
      items: {
        select: {
          id: true,
          assetNumber: true,
          assetTitle: true,
        },
      },
    },
    take: 250,
  });

  return {
    reservations: reservations.map((reservation) => ({
      id: reservation.id,
      reservationNumber: reservation.reservationNumber,
      customerName: reservation.customerName,
      startDateTime: reservation.startDateTime.toISOString(),
      endDateTime: reservation.endDateTime.toISOString(),
      status: reservation.status,
      items: reservation.items,
    })),
  };
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function CalendarPage() {
  const { reservations } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Calendar">
      <s-section heading="Next 45 days">
        {reservations.length === 0 ? (
          <s-paragraph>No active reservations in the next 45 days.</s-paragraph>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {reservations.map((reservation) => (
              <div
                key={reservation.id}
                style={{
                  border: "1px solid #e3e3e3",
                  borderRadius: 10,
                  padding: 16,
                  background: "white",
                }}
              >
                <strong>{reservation.reservationNumber}</strong> · {reservation.customerName}
                <div style={{ marginTop: 6 }}>
                  {dateTime(reservation.startDateTime)} → {dateTime(reservation.endDateTime)}
                </div>
                <div style={{ marginTop: 6, color: "#616161" }}>
                  {reservation.items.length > 0
                    ? reservation.items.map((item) => `${item.assetNumber} ${item.assetTitle}`).join(", ")
                    : "No equipment linked"}
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}
