import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const now = new Date();
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 3, 1);

  const reservations = await prisma.reservation.findMany({
    where: {
      shop: session.shop,
      startDateTime: { lt: rangeEnd },
      endDateTime: { gte: rangeStart },
      status: { not: "CANCELLED" },
    },
    orderBy: { startDateTime: "asc" },
    include: {
      items: {
        select: {
          id: true,
          assetNumber: true,
          assetTitle: true,
        },
        orderBy: { assetNumber: "asc" },
      },
    },
    take: 500,
  });

  return {
    generatedAt: now.toISOString(),
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

type CalendarReservation = ReturnType<typeof useLoaderData<typeof loader>>["reservations"][number];

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1);
}

function overlapsDay(reservation: CalendarReservation, day: Date) {
  const start = new Date(reservation.startDateTime);
  const end = new Date(reservation.endDateTime);
  return start < endOfDay(day) && end > startOfDay(day);
}

function monthCells(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [];

  for (let index = 0; index < firstWeekday; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

function monthTitle(year: number, month: number) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month, 1));
}

function timeOnly(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function ReservationChip({ reservation, day }: { reservation: CalendarReservation; day: Date }) {
  const start = new Date(reservation.startDateTime);
  const end = new Date(reservation.endDateTime);
  const startsToday = start.toDateString() === day.toDateString();
  const endsToday = end.toDateString() === day.toDateString();
  const timing = startsToday && endsToday
    ? `${timeOnly(reservation.startDateTime)}–${timeOnly(reservation.endDateTime)}`
    : startsToday
      ? `From ${timeOnly(reservation.startDateTime)}`
      : endsToday
        ? `Until ${timeOnly(reservation.endDateTime)}`
        : "All day";

  return (
    <div
      title={`${reservation.reservationNumber} · ${reservation.customerName}`}
      style={{
        border: "1px solid #c9cccf",
        borderRadius: 8,
        padding: "6px 8px",
        background: "#f6f6f7",
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      <div style={{ fontWeight: 650 }}>{reservation.reservationNumber}</div>
      <div>{reservation.customerName}</div>
      <div style={{ color: "#616161", marginTop: 2 }}>{timing}</div>
      {reservation.items.length > 0 && (
        <div style={{ color: "#616161", marginTop: 2 }}>
          {reservation.items.map((item) => item.assetNumber).join(", ")}
        </div>
      )}
    </div>
  );
}

function CalendarMonth({
  year,
  month,
  reservations,
  today,
}: {
  year: number;
  month: number;
  reservations: CalendarReservation[];
  today: Date;
}) {
  const cells = monthCells(year, month);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div style={{ border: "1px solid #e3e3e3", borderRadius: 12, overflow: "hidden", background: "white" }}>
      <div style={{ padding: "14px 16px", fontSize: 18, fontWeight: 650, borderBottom: "1px solid #e3e3e3" }}>
        {monthTitle(year, month)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
        {weekdays.map((weekday) => (
          <div
            key={weekday}
            style={{
              padding: "8px 6px",
              textAlign: "center",
              fontSize: 12,
              fontWeight: 650,
              color: "#616161",
              borderBottom: "1px solid #e3e3e3",
            }}
          >
            {weekday}
          </div>
        ))}

        {cells.map((day, index) => {
          if (!day) {
            return <div key={`empty-${index}`} style={{ minHeight: 118, background: "#fafafa", borderBottom: "1px solid #eee", borderRight: "1px solid #eee" }} />;
          }

          const dayReservations = reservations.filter((reservation) => overlapsDay(reservation, day));
          const isToday = day.toDateString() === today.toDateString();

          return (
            <div
              key={day.toISOString()}
              style={{
                minHeight: 118,
                padding: 8,
                borderBottom: "1px solid #eee",
                borderRight: "1px solid #eee",
                background: isToday ? "#f1f8ff" : "white",
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: isToday ? 700 : 500,
                  background: isToday ? "#202223" : "transparent",
                  color: isToday ? "white" : "#202223",
                  marginBottom: 6,
                }}
              >
                {day.getDate()}
              </div>

              <div style={{ display: "grid", gap: 5 }}>
                {dayReservations.slice(0, 3).map((reservation) => (
                  <ReservationChip key={reservation.id} reservation={reservation} day={day} />
                ))}
                {dayReservations.length > 3 && (
                  <div style={{ fontSize: 12, color: "#616161" }}>+{dayReservations.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { reservations, generatedAt } = useLoaderData<typeof loader>();
  const today = new Date(generatedAt);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const months = [0, 1, 2].map((offset) => new Date(currentYear, currentMonth + offset, 1));

  const activeReservations = reservations.filter(
    (reservation) => !["CANCELLED", "COMPLETED"].includes(reservation.status),
  );

  return (
    <s-page heading="Calendar">
      <s-section heading="Reservation calendar">
        <s-paragraph>
          Three-month view of reservations and equipment occupancy. Cancelled reservations are excluded.
        </s-paragraph>

        <div style={{ marginTop: 16, display: "grid", gap: 22 }}>
          {months.map((monthDate) => (
            <CalendarMonth
              key={`${monthDate.getFullYear()}-${monthDate.getMonth()}`}
              year={monthDate.getFullYear()}
              month={monthDate.getMonth()}
              reservations={activeReservations}
              today={today}
            />
          ))}
        </div>
      </s-section>

      <s-section heading="Legend">
        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <div><strong>{activeReservations.length}</strong> active reservation(s) in the loaded period.</div>
          <div>Each calendar item shows the reservation number, customer, time and equipment number(s).</div>
          <div>Status values currently in use: {Array.from(new Set(activeReservations.map((reservation) => statusLabel(reservation.status)))).join(", ") || "none"}.</div>
        </div>
      </s-section>
    </s-page>
  );
}
