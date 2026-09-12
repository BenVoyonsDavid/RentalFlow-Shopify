-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'BASIC',
    "language" TEXT NOT NULL DEFAULT 'AUTO',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "assetNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "productType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "dailyRateCents" INTEGER NOT NULL DEFAULT 0,
    "weeklyRateCents" INTEGER,
    "monthlyRateCents" INTEGER,
    "discountAfterDays" INTEGER,
    "discountPercent" REAL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "serialNumber" TEXT,
    "imageUrl" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "customerNumber" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "discountPercent" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "reservationNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "startDateTime" DATETIME NOT NULL,
    "endDateTime" DATETIME NOT NULL,
    "bufferBeforeHours" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterHours" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "workflowStage" TEXT NOT NULL DEFAULT 'RESERVATION',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "customerDiscountPercent" REAL NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "preTaxTotalCents" INTEGER NOT NULL DEFAULT 0,
    "tax1Name" TEXT,
    "tax1Rate" REAL NOT NULL DEFAULT 0,
    "tax1Cents" INTEGER NOT NULL DEFAULT 0,
    "tax2Name" TEXT,
    "tax2Rate" REAL NOT NULL DEFAULT 0,
    "tax2Cents" INTEGER NOT NULL DEFAULT 0,
    "taxTotalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "depositRequired" BOOLEAN NOT NULL DEFAULT false,
    "depositType" TEXT,
    "depositValue" REAL,
    "depositAmountCents" INTEGER NOT NULL DEFAULT 0,
    "amountDueNowCents" INTEGER NOT NULL DEFAULT 0,
    "balanceDueCents" INTEGER NOT NULL DEFAULT 0,
    "paymentMode" TEXT,
    "checkoutDateTime" DATETIME,
    "returnDateTime" DATETIME,
    "closedDateTime" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReservationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetNumber" TEXT NOT NULL,
    "assetTitle" TEXT NOT NULL,
    "startDateTime" DATETIME NOT NULL,
    "endDateTime" DATETIME NOT NULL,
    "blockedStartDateTime" DATETIME NOT NULL,
    "blockedEndDateTime" DATETIME NOT NULL,
    "bufferBeforeHours" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterHours" INTEGER NOT NULL DEFAULT 0,
    "billableDays" INTEGER NOT NULL DEFAULT 1,
    "lineTotalCents" INTEGER NOT NULL DEFAULT 0,
    "pricingMode" TEXT NOT NULL DEFAULT 'DAILY',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReservationItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReservationItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "paymentType" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "paymentDate" DATETIME,
    "reference" TEXT,
    "shopifyOrderId" TEXT,
    "shopifyTransactionId" TEXT,
    "remainingBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookingLock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "lockToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingLock_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eventDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityEntry_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX "Asset_shop_active_status_idx" ON "Asset"("shop", "active", "status");

-- CreateIndex
CREATE INDEX "Asset_shop_shopifyProductId_idx" ON "Asset"("shop", "shopifyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_shop_assetNumber_key" ON "Asset"("shop", "assetNumber");

-- CreateIndex
CREATE INDEX "Customer_shop_active_idx" ON "Customer"("shop", "active");

-- CreateIndex
CREATE INDEX "Customer_shop_email_idx" ON "Customer"("shop", "email");

-- CreateIndex
CREATE INDEX "Customer_shop_shopifyCustomerId_idx" ON "Customer"("shop", "shopifyCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shop_customerNumber_key" ON "Customer"("shop", "customerNumber");

-- CreateIndex
CREATE INDEX "Reservation_shop_startDateTime_status_idx" ON "Reservation"("shop", "startDateTime", "status");

-- CreateIndex
CREATE INDEX "Reservation_shop_customerId_startDateTime_idx" ON "Reservation"("shop", "customerId", "startDateTime");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_shop_reservationNumber_key" ON "Reservation"("shop", "reservationNumber");

-- CreateIndex
CREATE INDEX "ReservationItem_shop_assetId_blockedStartDateTime_blockedEndDateTime_idx" ON "ReservationItem"("shop", "assetId", "blockedStartDateTime", "blockedEndDateTime");

-- CreateIndex
CREATE INDEX "ReservationItem_shop_reservationId_idx" ON "ReservationItem"("shop", "reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationItem_reservationId_assetId_key" ON "ReservationItem"("reservationId", "assetId");

-- CreateIndex
CREATE INDEX "Payment_shop_reservationId_paymentDate_idx" ON "Payment"("shop", "reservationId", "paymentDate");

-- CreateIndex
CREATE INDEX "Payment_shop_shopifyOrderId_idx" ON "Payment"("shop", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_shop_paymentNumber_key" ON "Payment"("shop", "paymentNumber");

-- CreateIndex
CREATE INDEX "BookingLock_expiresAt_idx" ON "BookingLock"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingLock_shop_assetId_key" ON "BookingLock"("shop", "assetId");

-- CreateIndex
CREATE INDEX "ActivityEntry_shop_reservationId_eventDate_idx" ON "ActivityEntry"("shop", "reservationId", "eventDate");
