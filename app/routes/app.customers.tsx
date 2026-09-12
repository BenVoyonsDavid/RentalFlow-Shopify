import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const customers = await prisma.customer.findMany({
    where: { shop: session.shop },
    orderBy: [{ active: "desc" }, { customerNumber: "asc" }],
    take: 250,
  });

  return {
    customers: customers.map((customer) => ({
      id: customer.id,
      customerNumber: customer.customerNumber,
      name:
        [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
        customer.companyName ||
        "Unnamed customer",
      email: customer.email || "—",
      phone: customer.phone || "—",
      active: customer.active,
    })),
  };
};

export default function CustomersPage() {
  const { customers } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Customers">
      <s-section heading="Rental customers">
        {customers.length === 0 ? (
          <s-paragraph>No customers yet. Customer creation and Shopify customer linking are next in the MVP.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10 }}>Customer #</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Name</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Email</th>
                  <th style={{ textAlign: "left", padding: 10 }}>Phone</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} style={{ borderTop: "1px solid #e3e3e3" }}>
                    <td style={{ padding: 10 }}>{customer.customerNumber}</td>
                    <td style={{ padding: 10 }}>{customer.active ? customer.name : `${customer.name} (inactive)`}</td>
                    <td style={{ padding: 10 }}>{customer.email}</td>
                    <td style={{ padding: 10 }}>{customer.phone}</td>
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
