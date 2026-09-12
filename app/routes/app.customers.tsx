import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

function textValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function parsePercent(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");

  if (!normalized) return 0;

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) return null;
  return amount;
}

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
      firstName: customer.firstName || "",
      lastName: customer.lastName || "",
      companyName: customer.companyName || "",
      email: customer.email || "",
      phone: customer.phone || "",
      discountPercent: customer.discountPercent,
      notes: customer.notes || "",
      active: customer.active,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = textValue(formData.get("intent"));

  try {
    if (intent === "create") {
      const customerNumber = textValue(formData.get("customerNumber"));
      const firstName = textValue(formData.get("firstName")) || null;
      const lastName = textValue(formData.get("lastName")) || null;
      const companyName = textValue(formData.get("companyName")) || null;
      const email = textValue(formData.get("email")) || null;
      const phone = textValue(formData.get("phone")) || null;
      const notes = textValue(formData.get("notes")) || null;
      const discountPercent = parsePercent(formData.get("discountPercent"));

      if (!customerNumber) {
        return { ok: false, error: "Customer number is required." };
      }

      if (!firstName && !lastName && !companyName) {
        return { ok: false, error: "Enter a customer name or company name." };
      }

      if (discountPercent === null) {
        return { ok: false, error: "Discount must be between 0 and 100%." };
      }

      await prisma.customer.create({
        data: {
          shop,
          customerNumber,
          firstName,
          lastName,
          companyName,
          email,
          phone,
          notes,
          discountPercent,
          active: true,
        },
      });

      return { ok: true, message: `${customerNumber} was added.` };
    }

    if (intent === "update") {
      const id = textValue(formData.get("id"));
      const customerNumber = textValue(formData.get("customerNumber"));
      const firstName = textValue(formData.get("firstName")) || null;
      const lastName = textValue(formData.get("lastName")) || null;
      const companyName = textValue(formData.get("companyName")) || null;
      const email = textValue(formData.get("email")) || null;
      const phone = textValue(formData.get("phone")) || null;
      const notes = textValue(formData.get("notes")) || null;
      const discountPercent = parsePercent(formData.get("discountPercent"));

      const customer = await prisma.customer.findFirst({ where: { id, shop } });
      if (!customer) return { ok: false, error: "Customer not found." };

      if (!customerNumber) {
        return { ok: false, error: "Customer number is required." };
      }

      if (!firstName && !lastName && !companyName) {
        return { ok: false, error: "Enter a customer name or company name." };
      }

      if (discountPercent === null) {
        return { ok: false, error: "Discount must be between 0 and 100%." };
      }

      await prisma.customer.update({
        where: { id },
        data: {
          customerNumber,
          firstName,
          lastName,
          companyName,
          email,
          phone,
          notes,
          discountPercent,
        },
      });

      return { ok: true, message: `${customerNumber} was updated.` };
    }

    if (intent === "toggle") {
      const id = textValue(formData.get("id"));
      const customer = await prisma.customer.findFirst({ where: { id, shop } });
      if (!customer) return { ok: false, error: "Customer not found." };

      const nextActive = !customer.active;
      await prisma.customer.update({
        where: { id },
        data: { active: nextActive },
      });

      return {
        ok: true,
        message: `${customer.customerNumber} is now ${nextActive ? "active" : "inactive"}.`,
      };
    }

    return { ok: false, error: "Unknown customer action." };
  } catch (error) {
    console.error("Customer action failed", error);
    return {
      ok: false,
      error: "Could not save the customer. Check that the customer number is unique and try again.",
    };
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
  padding: "8px 12px",
  background: "white",
  cursor: "pointer",
};

function displayName(customer: {
  firstName: string;
  lastName: string;
  companyName: string;
}) {
  return (
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
    customer.companyName ||
    "Unnamed customer"
  );
}

export default function CustomersPage() {
  const { customers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Customers">
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

      <s-section heading="Add customer">
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginTop: 12,
            }}
          >
            <label style={labelStyle}>
              Customer #
              <input name="customerNumber" required style={inputStyle} placeholder="C-0001" />
            </label>
            <label style={labelStyle}>
              First name
              <input name="firstName" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Last name
              <input name="lastName" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Company
              <input name="companyName" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Email
              <input name="email" type="email" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Phone
              <input name="phone" style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Discount %
              <input name="discountPercent" type="number" min="0" max="100" step="0.01" defaultValue="0" style={inputStyle} />
            </label>
          </div>

          <label style={{ ...labelStyle, marginTop: 12 }}>
            Notes
            <textarea name="notes" rows={3} style={inputStyle} />
          </label>

          <div style={{ marginTop: 12 }}>
            <button type="submit" style={buttonStyle}>Add customer</button>
          </div>
        </Form>
      </s-section>

      <s-section heading={`Rental customers (${customers.length})`}>
        {customers.length === 0 ? (
          <s-paragraph>No customers yet.</s-paragraph>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {customers.map((customer) => (
              <div
                key={customer.id}
                style={{
                  border: "1px solid #e3e3e3",
                  borderRadius: 8,
                  padding: 14,
                  opacity: customer.active ? 1 : 0.65,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 10 }}>
                  {customer.customerNumber} · {displayName(customer)}
                  {!customer.active ? " · INACTIVE" : ""}
                </div>

                <Form method="post">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="id" value={customer.id} />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <label style={labelStyle}>
                      Customer #
                      <input name="customerNumber" defaultValue={customer.customerNumber} required style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      First name
                      <input name="firstName" defaultValue={customer.firstName} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Last name
                      <input name="lastName" defaultValue={customer.lastName} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Company
                      <input name="companyName" defaultValue={customer.companyName} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Email
                      <input name="email" type="email" defaultValue={customer.email} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Phone
                      <input name="phone" defaultValue={customer.phone} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Discount %
                      <input
                        name="discountPercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        defaultValue={customer.discountPercent}
                        style={inputStyle}
                      />
                    </label>
                  </div>

                  <label style={{ ...labelStyle, marginTop: 10 }}>
                    Notes
                    <textarea name="notes" rows={2} defaultValue={customer.notes} style={inputStyle} />
                  </label>

                  <div style={{ marginTop: 10 }}>
                    <button type="submit" style={buttonStyle}>Save changes</button>
                  </div>
                </Form>

                <Form method="post" style={{ marginTop: 8 }}>
                  <input type="hidden" name="intent" value="toggle" />
                  <input type="hidden" name="id" value={customer.id} />
                  <button type="submit" style={buttonStyle}>
                    {customer.active ? "Deactivate" : "Reactivate"}
                  </button>
                </Form>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}
