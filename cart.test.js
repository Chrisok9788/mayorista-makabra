import { describe, expect, it } from "vitest";

import { totalAmount } from "./cart.js";

describe("totalAmount", () => {
  it("aplica promos sin max cuando se alcanza el mínimo", () => {
    const cart = { "prod-1": 3 };
    const products = [
      {
        id: "prod-1",
        nombre: "Producto Promo",
        precio: 12,
        dpc: {
          tramos: [{ min: 3, precio: 10 }],
        },
      },
    ];

    expect(totalAmount(cart, products)).toBe(30);
  });

  it("usa precio base si no se alcanza el mínimo", () => {
    const cart = { "prod-2": 2 };
    const products = [
      {
        id: "prod-2",
        nombre: "Producto Base",
        precio: 8,
        dpc: {
          tramos: [{ min: 3, precio: 6 }],
        },
      },
    ];

    expect(totalAmount(cart, products)).toBe(16);
  });
});
