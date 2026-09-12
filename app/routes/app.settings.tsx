import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import prisma from "../db.server";
import { assetLimit, normalizePlan } from "../lib/plans";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop },
  });

  const plan = normalizePlan(settings.plan);

  return {
    shop: session.shop,
    plan,
    assetLimit: assetLimit(plan),
    language: settings.language,
    currency: settings.currency,
    timezone: settings.timezone,
  };
};

export default function SettingsPage() {
  const settings = useLoaderData<typeof loader>();

  return (
    <s-page heading="Settings">
      <s-section heading="RentalFlow account">
        <s-paragraph>Shop: {settings.shop}</s-paragraph>
        <s-paragraph>Plan: {settings.plan}</s-paragraph>
        <s-paragraph>Equipment limit: {settings.assetLimit ?? "Unlimited"}</s-paragraph>
      </s-section>

      <s-section heading="Localization">
        <s-paragraph>Language: {settings.language}</s-paragraph>
        <s-paragraph>Currency: {settings.currency}</s-paragraph>
        <s-paragraph>Timezone: {settings.timezone}</s-paragraph>
      </s-section>

      <s-section heading="Next step">
        <s-paragraph>
          Shopify billing and editable store settings will be connected after the core reservation workflow is functional.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
