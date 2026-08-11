import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./api/order-history.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      this.body = JSON.parse(String(chunk || "{}"));
    },
  };
}

function adminUser(role = "admin") {
  return {
    id: "staff-1",
    email: "admin@staff.makabra.local",
    user_metadata: {
      makabra_internal: true,
      active: true,
      username: "admin",
      name: "Administrador",
      role,
    },
  };
}

describe("clientes en el panel de pedidos", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("devuelve el análisis usando la acción protegida existente", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const target = String(url);
      if (target.endsWith("/auth/v1/user")) return jsonResponse(adminUser());
      if (target.includes("/rest/v1/clientes?")) {
        return jsonResponse([{ id: 10, codigo: "1234567", nombre: "Almacén", direccion: "Centro", telefono: "099000000", activo: true }]);
      }
      if (target.includes("/rest/v1/pedidos?")) {
        return jsonResponse([{ order_id: "MK-TEST", cliente_id: 10, cliente_codigo: "1234567", total_uyu: 1200, actualizaciones: 1, creado_en: "2026-08-10T12:00:00.000Z", ultimo_ingreso_en: "2026-08-10T12:00:00.000Z" }]);
      }
      throw new Error(`URL inesperada: ${target}`);
    }));

    const req = {
      method: "PUT",
      headers: { authorization: "Bearer test-token" },
      body: { action: "list_clients", period: "all" },
    };
    const res = responseCapture();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.clients.summary).toMatchObject({
      clientes_registrados: 1,
      pedidos: 1,
      monto_total: 1200,
    });
  });

  it("guarda clientes manuales protegidos de la sincronización de Sheets", async () => {
    let inserted = null;
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith("/auth/v1/user")) return jsonResponse(adminUser());
      if (target.endsWith("/rest/v1/clientes") && options.method === "POST") {
        inserted = JSON.parse(options.body);
        return jsonResponse([{ id: 11, ...inserted }], 201);
      }
      throw new Error(`URL inesperada: ${target}`);
    }));

    const req = {
      method: "PUT",
      headers: { authorization: "Bearer test-token" },
      body: {
        action: "create_client",
        codigo: "7654321",
        nombre: "Kiosco Nuevo",
        direccion: "Av. Principal 123",
        telefono: "098 123 456",
      },
    };
    const res = responseCapture();
    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(inserted).toMatchObject({
      codigo: "7654321",
      origen: "panel_admin",
      activo: true,
      tipo: "reparto",
    });
  });

  it("impide que un empleado consulte datos comerciales de clientes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/auth/v1/user")) return jsonResponse(adminUser("empleado"));
      throw new Error("No debería consultar tablas internas");
    }));

    const req = {
      method: "PUT",
      headers: { authorization: "Bearer test-token" },
      body: { action: "list_clients", period: "all" },
    };
    const res = responseCapture();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("ADMIN_REQUIRED");
  });
});
