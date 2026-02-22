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

  it("interpreta correctamente precios con punto decimal", () => {
    const cart = { "prod-3": 2 };
    const products = [
      {
        id: "prod-3",
        nombre: "Producto Decimal",
        precio: "10.5",
      },
    ];

    expect(totalAmount(cart, products)).toBe(21);
  });

  it("interpreta correctamente precios con formato mixto", () => {
    const cart = { "prod-4": 1 };
    const products = [
      {
        id: "prod-4",
        nombre: "Producto Mixto",
        precio: "1.234,5",
      },
    ];

    expect(totalAmount(cart, products)).toBe(1235);
  });
});
