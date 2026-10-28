/**
 * Comprehensive Unit Test Suite for Milestone 3
 * WooCommerce REST API v3 Sync, Real-Time Stock Verification & Shopify Roadmap Adapter
 */

import { describe, expect, test } from "bun:test";
import type {
  ECommercePlatformAdapter,
  OrderBookingPayload,
  UnifiedProduct,
} from "../ecommerce/ecommerce.interface.js";
import {
  InventoryService,
  inventoryService,
} from "../ecommerce/inventory.service.js";
import { ShopifyClient } from "../ecommerce/shopify.client.js";
import { WooCommerceClient } from "../ecommerce/woocommerce.client.js";

describe("Milestone 3: WooCommerce Sync, Stock Verification & Shopify Roadmap", () => {
  // =========================================================================
  // 1. Product Catalog Fetch & Pagination
  // =========================================================================
  describe("1. WooCommerce Product Catalog Fetch & Pagination", () => {
    test("fetches a single page of published products and maps to UnifiedProduct", async () => {
      const mockWcProducts = [
        {
          id: 101,
          name: "Premium Cotton Panjabi",
          slug: "premium-cotton-panjabi",
          type: "simple",
          status: "publish",
          sku: "PAN-101",
          price: "1850",
          regular_price: "2200",
          sale_price: "1850",
          description: "<p>100% fine cotton traditional panjabi</p>",
          short_description: "Fine cotton panjabi",
          purchasable: true,
          manage_stock: true,
          stock_quantity: 15,
          stock_status: "instock",
          backorders_allowed: false,
          categories: [
            { id: 12, name: "Men's Clothing", slug: "mens-clothing" },
          ],
          images: [{ id: 1, src: "https://shop.local/images/pan-101.jpg" }],
          attributes: [
            {
              id: 1,
              name: "Fabric",
              options: ["100% Cotton"],
              variation: false,
            },
          ],
        },
      ];

      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_valid_key_123",
        consumerSecret: "cs_valid_secret_456",
        customFetch: async (input, init) => {
          const url = new URL(String(input));
          expect(url.pathname).toBe("/wp-json/wc/v3/products");
          expect(url.searchParams.get("status")).toBe("publish");
          expect(url.searchParams.get("page")).toBe("1");

          // Basic Auth header check
          const auth = init?.headers
            ? (init.headers as Record<string, string>).Authorization
            : "";
          expect(auth).toMatch(/^Basic /);

          return new Response(JSON.stringify(mockWcProducts), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-WP-Total": "1",
              "X-WP-TotalPages": "1",
            },
          });
        },
      });

      const products = await client.syncProducts();
      expect(products).toHaveLength(1);

      const p = products[0];
      expect(p.id).toBe("101");
      expect(p.name).toBe("Premium Cotton Panjabi");
      expect(p.sku).toBe("PAN-101");
      expect(p.price).toBe(1850);
      expect(p.regularPrice).toBe(2200);
      expect(p.salePrice).toBe(1850);
      expect(p.inStock).toBe(true);
      expect(p.stockQuantity).toBe(15);
      expect(p.images).toEqual(["https://shop.local/images/pan-101.jpg"]);
      expect(p.type).toBe("simple");
      expect(p.variations).toHaveLength(0);
    });

    test("traverses multiple pages using X-WP-TotalPages and aggregates full catalog", async () => {
      const page1Products = [
        {
          id: 201,
          name: "Linen Shirt White",
          type: "simple",
          status: "publish",
          price: "1200",
          stock_status: "instock",
        },
        {
          id: 202,
          name: "Linen Shirt Navy",
          type: "simple",
          status: "publish",
          price: "1200",
          stock_status: "instock",
        },
      ];

      const page2Products = [
        {
          id: 203,
          name: "Denim Jeans Regular",
          type: "simple",
          status: "publish",
          price: "2400",
          stock_status: "instock",
        },
      ];

      const requestedPages: number[] = [];

      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_test",
        consumerSecret: "cs_test",
        perPage: 2,
        customFetch: async (input) => {
          const url = new URL(String(input));
          const page = Number.parseInt(url.searchParams.get("page") || "1", 10);
          requestedPages.push(page);

          if (page === 1) {
            return new Response(JSON.stringify(page1Products), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-WP-Total": "3",
                "X-WP-TotalPages": "2",
              },
            });
          }
          if (page === 2) {
            return new Response(JSON.stringify(page2Products), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-WP-Total": "3",
                "X-WP-TotalPages": "2",
              },
            });
          }

          return new Response("[]", { status: 200 });
        },
      });

      const catalog = await client.syncProducts();
      expect(catalog).toHaveLength(3);
      expect(requestedPages).toEqual([1, 2]);
      expect(catalog.map((p) => p.name)).toEqual([
        "Linen Shirt White",
        "Linen Shirt Navy",
        "Denim Jeans Regular",
      ]);
    });

    test("passes modified_after parameter for incremental product synchronization", async () => {
      const cutoffDate = new Date("2026-10-25T12:00:00.000Z");
      let capturedModifiedAfter = "";

      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_test",
        consumerSecret: "cs_test",
        customFetch: async (input) => {
          const url = new URL(String(input));
          capturedModifiedAfter = url.searchParams.get("modified_after") || "";
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-WP-Total": "0",
              "X-WP-TotalPages": "1",
            },
          });
        },
      });

      await client.syncProducts(cutoffDate);
      expect(capturedModifiedAfter).toBe(cutoffDate.toISOString());
    });
  });

  // =========================================================================
  // 2. Variation Matrix Resolution
  // =========================================================================
  describe("2. Variation Matrix Resolution", () => {
    test("automatically fetches and resolves child variation matrix for variable products", async () => {
      const variableProduct = {
        id: 500,
        name: "Vintage Denim Jacket",
        type: "variable",
        status: "publish",
        sku: "VDJ-00",
        price: "2800",
        regular_price: "3200",
        sale_price: "2800",
        purchasable: true,
        attributes: [
          {
            id: 1,
            name: "Size",
            options: ["M", "L", "XL"],
            variation: true,
          },
          {
            id: 2,
            name: "Color",
            options: ["Black", "Blue"],
            variation: true,
          },
        ],
        variations: [501, 502, 503],
      };

      const variationsData = [
        {
          id: 501,
          sku: "VDJ-BLK-M",
          price: "2800",
          regular_price: "3200",
          sale_price: "2800",
          status: "publish",
          purchasable: true,
          manage_stock: true,
          stock_quantity: 4,
          stock_status: "instock",
          backorders_allowed: false,
          attributes: [
            { id: 1, name: "Size", option: "M" },
            { id: 2, name: "Color", option: "Black" },
          ],
        },
        {
          id: 502,
          sku: "VDJ-BLK-XL",
          price: "2800",
          regular_price: "3200",
          status: "publish",
          purchasable: true,
          manage_stock: true,
          stock_quantity: 0,
          stock_status: "outofstock",
          backorders_allowed: false,
          attributes: [
            { id: 1, name: "Size", option: "XL" },
            { id: 2, name: "Color", option: "Black" },
          ],
        },
        {
          id: 503,
          sku: "VDJ-BLU-XL",
          price: "2800",
          regular_price: "3200",
          status: "publish",
          purchasable: true,
          manage_stock: true,
          stock_quantity: 8,
          stock_status: "instock",
          backorders_allowed: false,
          attributes: [
            { id: 1, name: "Size", option: "XL" },
            { id: 2, name: "Color", option: "Blue" },
          ],
        },
      ];

      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_test",
        consumerSecret: "cs_test",
        customFetch: async (input) => {
          const url = new URL(String(input));

          if (url.pathname === "/wp-json/wc/v3/products") {
            return new Response(JSON.stringify([variableProduct]), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-WP-Total": "1",
                "X-WP-TotalPages": "1",
              },
            });
          }

          if (url.pathname === "/wp-json/wc/v3/products/500/variations") {
            return new Response(JSON.stringify(variationsData), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response("Not Found", { status: 404 });
        },
      });

      const products = await client.syncProducts();
      expect(products).toHaveLength(1);

      const p = products[0];
      expect(p.type).toBe("variable");
      expect(p.variations).toHaveLength(3);

      // Check variant 1: Size M Black (in stock)
      const varM = p.variations.find((v) => v.id === "501");
      expect(varM).toBeDefined();
      expect(varM?.attributes).toEqual({ Size: "M", Color: "Black" });
      expect(varM?.inStock).toBe(true);
      expect(varM?.stockQuantity).toBe(4);

      // Check variant 2: Size XL Black (out of stock)
      const varXLBlack = p.variations.find((v) => v.id === "502");
      expect(varXLBlack).toBeDefined();
      expect(varXLBlack?.attributes).toEqual({ Size: "XL", Color: "Black" });
      expect(varXLBlack?.inStock).toBe(false);
      expect(varXLBlack?.stockQuantity).toBe(0);

      // Check variant 3: Size XL Blue (in stock)
      const varXLBlue = p.variations.find((v) => v.id === "503");
      expect(varXLBlue).toBeDefined();
      expect(varXLBlue?.attributes).toEqual({ Size: "XL", Color: "Blue" });
      expect(varXLBlue?.inStock).toBe(true);
      expect(varXLBlue?.stockQuantity).toBe(8);
    });
  });

  // =========================================================================
  // 3. Real-Time Stock Evaluation
  // =========================================================================
  describe("3. Real-Time Stock Evaluation & Order Stockout Prevention", () => {
    test("approves item when stock is sufficient and purchasable", () => {
      const result = inventoryService.evaluateStock(
        {
          purchasable: true,
          status: "publish",
          stock_status: "instock",
          manage_stock: true,
          stock_quantity: 5,
          price: "1500",
        },
        2,
      );

      expect(result.available).toBe(true);
      expect(result.availableQuantity).toBe(5);
      expect(result.unitPrice).toBe(1500);
      expect(result.errorReason).toBeUndefined();
    });

    test("rejects item when stock_status is outofstock", () => {
      const result = inventoryService.evaluateStock({
        purchasable: true,
        status: "publish",
        stock_status: "outofstock",
        manage_stock: true,
        stock_quantity: 0,
        price: "1500",
      });

      expect(result.available).toBe(false);
      expect(result.availableQuantity).toBe(0);
      expect(result.errorReason).toBe("Item is out of stock");
    });

    test("rejects item when requested quantity exceeds available stock", () => {
      const result = inventoryService.evaluateStock(
        {
          purchasable: true,
          status: "publish",
          stock_status: "instock",
          manage_stock: true,
          stock_quantity: 1,
          backorders_allowed: false,
          price: "950",
        },
        2,
      );

      expect(result.available).toBe(false);
      expect(result.availableQuantity).toBe(1);
      expect(result.errorReason).toContain("Only 1 item(s) available in stock");
    });

    test("allows order if backorders are permitted even when stock_quantity is 0", () => {
      const result = inventoryService.evaluateStock(
        {
          purchasable: true,
          status: "publish",
          stock_status: "onbackorder",
          manage_stock: true,
          stock_quantity: 0,
          backorders_allowed: true,
          price: "2100",
        },
        3,
      );

      expect(result.available).toBe(true);
      expect(result.availableQuantity).toBe(0);
      expect(result.unitPrice).toBe(2100);
    });

    test("rejects unpublished or draft products", () => {
      const result = inventoryService.evaluateStock({
        purchasable: true,
        status: "draft",
        stock_status: "instock",
        price: "1000",
      });

      expect(result.available).toBe(false);
      expect(result.errorReason).toContain("expected publish");
    });

    test("rejects non-purchasable products", () => {
      const result = inventoryService.evaluateStock({
        purchasable: false,
        status: "publish",
        stock_status: "instock",
        price: "1000",
      });

      expect(result.available).toBe(false);
      expect(result.errorReason).toBe("Product is not purchasable");
    });

    test("validates multi-item cart via WooCommerceClient endpoint queries", async () => {
      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_test",
        consumerSecret: "cs_test",
        customFetch: async (input) => {
          const url = new URL(String(input));

          if (url.pathname === "/wp-json/wc/v3/products/101") {
            return new Response(
              JSON.stringify({
                id: 101,
                purchasable: true,
                status: "publish",
                stock_status: "instock",
                manage_stock: true,
                stock_quantity: 10,
                price: "1000",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          if (url.pathname === "/wp-json/wc/v3/products/102/variations/202") {
            return new Response(
              JSON.stringify({
                id: 202,
                purchasable: true,
                status: "publish",
                stock_status: "outofstock",
                manage_stock: true,
                stock_quantity: 0,
                price: "1500",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          return new Response("Not found", { status: 404 });
        },
      });

      const validation = await client.checkStock([
        { productId: "101", quantity: 2 },
        { productId: "102", variationId: "202", quantity: 1 },
      ]);

      expect(validation.available).toBe(false);
      expect(validation.items).toHaveLength(2);
      expect(validation.items[0].available).toBe(true);
      expect(validation.items[0].unitPrice).toBe(1000);
      expect(validation.items[1].available).toBe(false);
      expect(validation.items[1].reason).toBe("Item is out of stock");
    });
  });

  // =========================================================================
  // 4. In-Stock Alternative Variant Suggestions
  // =========================================================================
  describe("4. Alternative In-Stock Variant Suggestions", () => {
    const mockProductWithVariants: UnifiedProduct = {
      id: "700",
      name: "Oxford Cotton Slim Shirt",
      sku: "OCS-00",
      price: 1650,
      regularPrice: 1900,
      description: "Fine formal oxford shirt",
      images: [],
      inStock: true,
      stockQuantity: 12,
      attributes: [],
      variations: [
        {
          id: "701",
          sku: "OCS-BLK-M",
          price: 1650,
          inStock: true,
          stockQuantity: 5,
          attributes: { Size: "M", Color: "Black" },
        },
        {
          id: "702",
          sku: "OCS-BLK-L",
          price: 1650,
          inStock: true,
          stockQuantity: 3,
          attributes: { Size: "L", Color: "Black" },
        },
        {
          id: "703",
          sku: "OCS-BLK-XL",
          price: 1650,
          inStock: false,
          stockQuantity: 0,
          attributes: { Size: "XL", Color: "Black" },
        },
        {
          id: "704",
          sku: "OCS-BLU-XL",
          price: 1650,
          inStock: true,
          stockQuantity: 4,
          attributes: { Size: "XL", Color: "Blue" },
        },
        {
          id: "705",
          sku: "OCS-WHT-S",
          price: 1650,
          inStock: true,
          stockQuantity: 2,
          attributes: { Size: "S", Color: "White" },
        },
      ],
    };

    test("suggests available alternative sizes in the same color when requested size is sold out", () => {
      // Customer asked for Size XL in Black (id 703, sold out)
      const alternatives = inventoryService.findInStockAlternatives(
        mockProductWithVariants,
        "703",
      );

      expect(alternatives.length).toBeGreaterThan(0);

      // Same color matches should come first (Size M Black, Size L Black)
      const sameColorMatches = alternatives.filter(
        (a) => a.matchType === "same_color_different_size",
      );
      expect(sameColorMatches).toHaveLength(2);
      expect(sameColorMatches.map((m) => m.variation.attributes.Size)).toEqual([
        "M",
        "L",
      ]);

      // Same size in different color (Size XL in Blue)
      const sameSizeMatches = alternatives.filter(
        (a) => a.matchType === "same_size_different_color",
      );
      expect(sameSizeMatches).toHaveLength(1);
      expect(sameSizeMatches[0].variation.attributes.Color).toBe("Blue");
    });

    test("returns empty list if product has no variations or all are sold out", () => {
      const soldOutProduct: UnifiedProduct = {
        ...mockProductWithVariants,
        variations: [
          {
            id: "801",
            sku: "SOLDOUT-1",
            price: 500,
            inStock: false,
            stockQuantity: 0,
            attributes: { Size: "M" },
          },
        ],
      };

      const alternatives = inventoryService.findInStockAlternatives(
        soldOutProduct,
        "801",
      );
      expect(alternatives).toHaveLength(0);
    });
  });

  // =========================================================================
  // 5. Shopify Platform Adapter Conformance
  // =========================================================================
  describe("5. Shopify GraphQL Adapter Conformance", () => {
    test("implements ECommercePlatformAdapter interface with platform === 'shopify'", () => {
      const client = new ShopifyClient({
        shopDomain: "test-store.myshopify.com",
        accessToken: "shpat_mock_token_12345",
      });

      const adapter: ECommercePlatformAdapter = client;
      expect(adapter.platform).toBe("shopify");
    });

    test("syncs products from Shopify GraphQL response and normalizes to UnifiedProduct", async () => {
      const mockGraphQLResponse = {
        data: {
          products: {
            pageInfo: {
              hasNextPage: false,
              endCursor: null,
            },
            edges: [
              {
                node: {
                  id: "gid://shopify/Product/987654321",
                  title: "Shopify Silk Saree",
                  description: "Pure silk luxury saree",
                  handle: "shopify-silk-saree",
                  status: "ACTIVE",
                  totalInventory: 20,
                  images: {
                    edges: [
                      {
                        node: {
                          url: "https://cdn.shopify.com/saree.jpg",
                          altText: "Silk saree",
                        },
                      },
                    ],
                  },
                  options: [{ name: "Color", values: ["Red", "Magenta"] }],
                  variants: {
                    edges: [
                      {
                        node: {
                          id: "gid://shopify/ProductVariant/111222333",
                          sku: "SAR-RED",
                          price: "4500.00",
                          compareAtPrice: "5000.00",
                          availableForSale: true,
                          inventoryQuantity: 12,
                          selectedOptions: [{ name: "Color", value: "Red" }],
                          image: {
                            url: "https://cdn.shopify.com/saree-red.jpg",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      };

      const client = new ShopifyClient({
        shopDomain: "test-store.myshopify.com",
        accessToken: "shpat_mock_token",
        customFetch: async (input, init) => {
          expect(String(input)).toContain("/admin/api/2024-04/graphql.json");
          const body = JSON.parse(String(init?.body));
          expect(body.query).toContain("products");

          return new Response(JSON.stringify(mockGraphQLResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      });

      const products = await client.syncProducts();
      expect(products).toHaveLength(1);

      const p = products[0];
      expect(p.id).toBe("987654321");
      expect(p.name).toBe("Shopify Silk Saree");
      expect(p.price).toBe(4500);
      expect(p.regularPrice).toBe(5000);
      expect(p.salePrice).toBe(4500);
      expect(p.inStock).toBe(true);
      expect(p.variations).toHaveLength(1);
      expect(p.variations[0].id).toBe("111222333");
      expect(p.variations[0].attributes).toEqual({ Color: "Red" });
    });

    test("checks real-time stock for Shopify variant via GraphQL query", async () => {
      const mockVariantResponse = {
        data: {
          node: {
            id: "gid://shopify/ProductVariant/555444",
            title: "Large / Navy",
            price: "1600.00",
            availableForSale: true,
            inventoryQuantity: 7,
          },
        },
      };

      const client = new ShopifyClient({
        shopDomain: "test-store.myshopify.com",
        accessToken: "shpat_test",
        customFetch: async () => {
          return new Response(JSON.stringify(mockVariantResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      });

      const validation = await client.checkStock([
        { productId: "999", variationId: "555444", quantity: 2 },
      ]);

      expect(validation.available).toBe(true);
      expect(validation.items[0].availableQuantity).toBe(7);
      expect(validation.items[0].unitPrice).toBe(1600);
    });

    test("creates order on Shopify using GraphQL mutation", async () => {
      const mockOrderResponse = {
        data: {
          orderCreate: {
            order: {
              id: "gid://shopify/Order/777888999",
              name: "#1001",
              currentTotalPriceSet: {
                shopMoney: {
                  amount: "3320.00",
                  currencyCode: "BDT",
                },
              },
              displayFinancialStatus: "AUTHORIZED",
            },
            userErrors: [],
          },
        },
      };

      const client = new ShopifyClient({
        shopDomain: "test-store.myshopify.com",
        accessToken: "shpat_test",
        customFetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body));
          expect(body.query).toContain("orderCreate");
          expect(body.variables.order.shippingAddress.name).toBe(
            "Tanvir Ahmed",
          );
          expect(body.variables.order.shippingAddress.phone).toBe(
            "01819000000",
          );

          return new Response(JSON.stringify(mockOrderResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      });

      const payload: OrderBookingPayload = {
        customerName: "Tanvir Ahmed",
        phoneNumber: "01819000000",
        deliveryAddress: "Mirpur 10, Dhaka",
        deliveryZone: "inside_dhaka",
        items: [
          {
            productId: "999",
            variationId: "555444",
            quantity: 2,
            unitPrice: 1600,
          },
        ],
        deliveryFee: 120,
        paymentMethod: "cod",
      };

      const result = await client.createOrder(payload);
      expect(result.success).toBe(true);
      expect(result.orderId).toBe("777888999");
      expect(result.orderTotal).toBe(3320);
      expect(result.status).toBe("AUTHORIZED");
    });

    test("handles Shopify userErrors and rate limit (HTTP 429)", async () => {
      // Test userErrors in mutation
      const userErrorClient = new ShopifyClient({
        shopDomain: "test-store.myshopify.com",
        accessToken: "shpat_test",
        customFetch: async () => {
          return new Response(
            JSON.stringify({
              data: {
                orderCreate: {
                  order: null,
                  userErrors: [
                    {
                      field: ["shippingAddress", "phone"],
                      message: "Invalid phone number format",
                    },
                  ],
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      });

      const orderResult = await userErrorClient.createOrder({
        customerName: "Test",
        phoneNumber: "invalid",
        deliveryAddress: "Dhaka",
        deliveryZone: "inside_dhaka",
        items: [{ productId: "1", quantity: 1, unitPrice: 100 }],
        deliveryFee: 60,
        paymentMethod: "cod",
      });

      expect(orderResult.success).toBe(false);
      expect(orderResult.error).toContain("Invalid phone number format");

      // Test HTTP 429
      const throttledClient = new ShopifyClient({
        shopDomain: "test-store.myshopify.com",
        accessToken: "shpat_test",
        customFetch: async () => {
          return new Response("Too Many Requests", {
            status: 429,
            statusText: "Too Many Requests",
          });
        },
      });

      expect(throttledClient.syncProducts()).rejects.toThrow(
        /rate limit exceeded/,
      );
    });
  });

  // =========================================================================
  // 6. Live Order Creation Payload Formulation & Error Handling
  // =========================================================================
  describe("6. Live Order Creation Payload Formulation & Error Handling", () => {
    test("formulates complete Cash on Delivery (COD) order payload for Inside Dhaka", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Raw JSON sent payload
      let sentPayload: any = null;

      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_live",
        consumerSecret: "cs_live",
        customFetch: async (input, init) => {
          expect(String(input)).toContain("/wp-json/wc/v3/orders");
          expect(init?.method).toBe("POST");
          sentPayload = JSON.parse(String(init?.body));

          return new Response(
            JSON.stringify({
              id: 9942,
              order_key: "wc_order_abc123",
              status: "processing",
              total: "1910.00",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        },
      });

      const orderPayload: OrderBookingPayload = {
        customerName: "Rahim Uddin",
        phoneNumber: "01711000000",
        deliveryAddress: "House 12, Road 5, Block B, Dhanmondi",
        deliveryZone: "inside_dhaka",
        items: [
          {
            productId: "1042",
            variationId: "1045",
            quantity: 1,
            unitPrice: 1850,
          },
        ],
        deliveryFee: 60,
        paymentMethod: "cod",
        customerJid: "8801711000000@s.whatsapp.net",
        conversationId: "conv-uuid-12345",
        notes: "Deliver in the afternoon please.",
      };

      const result = await client.createOrder(orderPayload);
      expect(result.success).toBe(true);
      expect(result.orderId).toBe("9942");
      expect(result.orderTotal).toBe(1910);
      expect(result.status).toBe("processing");

      // Verify payload formulation details
      expect(sentPayload.payment_method).toBe("cod");
      expect(sentPayload.payment_method_title).toBe("Cash on Delivery");
      expect(sentPayload.status).toBe("processing");
      expect(sentPayload.billing.first_name).toBe("Rahim Uddin");
      expect(sentPayload.billing.phone).toBe("01711000000");
      expect(sentPayload.billing.country).toBe("BD");
      expect(sentPayload.line_items).toEqual([
        { product_id: 1042, variation_id: 1045, quantity: 1 },
      ]);
      expect(sentPayload.shipping_lines[0].total).toBe("60.00");
      expect(sentPayload.shipping_lines[0].method_title).toBe(
        "Inside Dhaka Delivery",
      );
      expect(sentPayload.customer_note).toBe(
        "Deliver in the afternoon please.",
      );

      const sourceMeta = sentPayload.meta_data.find(
        (m: { key: string; value: string }) => m.key === "_source",
      );
      expect(sourceMeta?.value).toBe("omniteam_ai_agent");

      const zoneMeta = sentPayload.meta_data.find(
        (m: { key: string; value: string }) => m.key === "_delivery_zone",
      );
      expect(zoneMeta?.value).toBe("inside_dhaka");
    });

    test("sets order status to on-hold for Outside Dhaka COD orders (awaiting advance delivery fee)", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Raw JSON sent payload
      let sentPayload: any = null;

      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_live",
        consumerSecret: "cs_live",
        customFetch: async (_input, init) => {
          sentPayload = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              id: 9943,
              status: "on-hold",
              total: "2120.00",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        },
      });

      const orderPayload: OrderBookingPayload = {
        customerName: "Kazi Nazrul",
        phoneNumber: "01912345678",
        deliveryAddress: "GEC Circle, Chittagong",
        deliveryZone: "outside_dhaka",
        items: [{ productId: "2000", quantity: 1, unitPrice: 2000 }],
        deliveryFee: 120,
        paymentMethod: "cod",
      };

      const result = await client.createOrder(orderPayload);
      expect(result.success).toBe(true);
      expect(sentPayload.status).toBe("on-hold");
      expect(sentPayload.shipping_lines[0].method_title).toBe(
        "Outside Dhaka Delivery",
      );
      expect(sentPayload.shipping_lines[0].total).toBe("120.00");
    });

    test("gracefully handles HTTP 401/403 Invalid API Credentials", async () => {
      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_invalid",
        consumerSecret: "cs_invalid",
        customFetch: async () => {
          return new Response(
            JSON.stringify({
              code: "woocommerce_rest_cannot_view",
              message: "Sorry, you cannot list resources.",
            }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        },
      });

      expect(client.syncProducts()).rejects.toThrow(
        /WooCommerce authentication failed \(401\)/,
      );
    });

    test("handles WooCommerce 400 out-of-stock order rejection gracefully", async () => {
      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_live",
        consumerSecret: "cs_live",
        customFetch: async () => {
          return new Response(
            JSON.stringify({
              code: "woocommerce_rest_out_of_stock",
              message: "An item in your cart is currently out of stock.",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        },
      });

      const result = await client.createOrder({
        customerName: "Test Customer",
        phoneNumber: "01700000000",
        deliveryAddress: "Dhaka",
        deliveryZone: "inside_dhaka",
        items: [{ productId: "999", quantity: 5, unitPrice: 100 }],
        deliveryFee: 60,
        paymentMethod: "cod",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("out of stock");
    });

    test("handles network timeout gracefully with AbortController", async () => {
      const client = new WooCommerceClient({
        baseUrl: "https://my-store.local",
        consumerKey: "ck_live",
        consumerSecret: "cs_live",
        timeoutMs: 50,
        customFetch: async (_, init) => {
          return new Promise((_, reject) => {
            const timer = setTimeout(() => {
              reject(new Error("Should have aborted before this"));
            }, 500);

            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              const abortErr = new Error("The operation was aborted");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          });
        },
      });

      expect(client.syncProducts()).rejects.toThrow(/timeout/i);
    });

    test("inventory cache reduces redundant external adapter calls and respects bypassCache", async () => {
      let adapterCallCount = 0;

      const mockAdapter: ECommercePlatformAdapter = {
        platform: "woocommerce",
        syncProducts: async () => [],
        checkStock: async (items) => {
          adapterCallCount++;
          return {
            available: true,
            items: items.map((i) => ({
              productId: i.productId,
              variationId: i.variationId,
              available: true,
              availableQuantity: 10,
              unitPrice: 500,
            })),
            totalPrice: items.length * 500,
          };
        },
        createOrder: async () => ({
          success: true,
          orderId: "1",
          orderTotal: 500,
          status: "processing",
        }),
      };

      const invService = new InventoryService({ cacheTtlMs: 2000 });

      // First call -> hits adapter
      const res1 = await invService.validateCartStock(mockAdapter, [
        { productId: "10", quantity: 1 },
      ]);
      expect(res1.available).toBe(true);
      expect(adapterCallCount).toBe(1);

      // Second call -> cached, does NOT hit adapter
      const res2 = await invService.validateCartStock(mockAdapter, [
        { productId: "10", quantity: 1 },
      ]);
      expect(res2.available).toBe(true);
      expect(adapterCallCount).toBe(1);

      // Third call with bypassCache: true -> hits adapter again
      const res3 = await invService.validateCartStock(
        mockAdapter,
        [{ productId: "10", quantity: 1 }],
        { bypassCache: true },
      );
      expect(res3.available).toBe(true);
      expect(adapterCallCount).toBe(2);
    });
  });
});
