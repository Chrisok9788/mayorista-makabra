import { describe, expect, it } from "vitest";
import { buildClientAnalytics } from "./lib/client-analytics.js";

describe("buildClientAnalytics", () => {
  it("agrupa montos y cuenta pedidos acumulados por cliente", () => {
    const result = buildClientAnalytics(
      [
        { id: 1, codigo: "1234567", nombre: "Almacén Sur", activo: true },
        { id: 2, codigo: "7654321", nombre: "Kiosco Norte", activo: false },
      ],
      [
        {
          order_id: "MK-1",
          cliente_id: 1,
          cliente_codigo: "1234567",
          total_uyu: 1500,
          actualizaciones: 2,
          creado_en: "2026-08-01T12:00:00.000Z",
          ultimo_ingreso_en: "2026-08-01T14:00:00.000Z",
        },
        {
          order_id: "MK-2",
          cliente_codigo: "1234567",
          total_uyu: 900,
          actualizaciones: 1,
          creado_en: "2026-08-08T12:00:00.000Z",
        },
      ],
    );

    const customer = result.rows.find((row) => row.codigo === "1234567");
    expect(customer).toMatchObject({
      pedidos: 3,
      monto_total: 2400,
      ticket_promedio: 800,
      ultima_compra: "2026-08-08T12:00:00.000Z",
    });
    expect(result.summary).toMatchObject({
      clientes_registrados: 2,
      clientes_activos: 1,
      clientes_con_pedidos: 1,
      pedidos: 3,
      monto_total: 2400,
      ticket_promedio: 800,
    });
  });

  it("conserva en el análisis pedidos de clientes eliminados del padrón", () => {
    const result = buildClientAnalytics([], [
      {
        order_id: "MK-HISTORICO",
        cliente_codigo: "1111111",
        cliente_nombre: "Cliente anterior",
        total_uyu: 500,
        creado_en: "2026-07-10T10:00:00.000Z",
      },
    ]);

    expect(result.rows[0]).toMatchObject({
      codigo: "1111111",
      nombre: "Cliente anterior",
      registrado: false,
      pedidos: 1,
      monto_total: 500,
    });
  });
});
