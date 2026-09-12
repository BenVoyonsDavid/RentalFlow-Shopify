import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const reservations = await prisma.reservation.findMany({
    where: { shop: session.shop },
    orderBy: { startDateTime: "asc" },
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
      totalCents: reservation.totalCents,
      currency: reservation.currency,
    })),
  };
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

export default function ReservationsPage() {
  const { reservations } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Reservations">
      <s-section heading="Rental reservations">
        {reservations.length === 0 ? (
          <s-paragraph>No reservations yet. Reservation creation and availability checks are the next MVP step.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10 }}>Reservation</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Customer</th>
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
