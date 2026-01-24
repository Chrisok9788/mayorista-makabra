import os
import json
import base64
import datetime
import requests

BASE_URL = os.environ.get("API_BASE_URL", "").rstrip("/")
ID_EMPRESA = os.environ.get("API_ID_EMPRESA", "")
ID_LOCAL = os.environ.get("API_ID_LOCAL", "")
USER = os.environ.get("API_USER", "")
PASS = os.environ.get("API_PASS", "")

PRODUCTS_FILE = "products.json"
STATE_FILE = "sync-state.json"

TAKE = 500

def die(msg):
    raise SystemExit(msg)

def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def basic_auth_header(user, pwd):
    token = base64.b64encode(f"{user}:{pwd}".encode("utf-8")).decode("utf-8")
    return f"Basic {token}"

def now_utc_parts():
    d = datetime.datetime.utcnow()
    return d.strftime("%Y-%m-%d"), d.strftime("%H:%M:%S")

def pick_barcode(item):
    cbs = item.get("codigosDeBarras")
    if isinstance(cbs, list) and len(cbs) > 0:
        return str(cbs[0])
    return ""

def pick_price(item):
    es_oferta = bool(item.get("esPrecioOferta"))
    if es_oferta and isinstance(item.get("precioOferta"), (int, float)):
        return item["precioOferta"]
    if isinstance(item.get("precioRegular"), (int, float)):
        return item["precioRegular"]
    return None

def parse_dpc(item):
    """
    Mapea descuentoPorCantidad de la API a un formato simple en products.json:
    dpc = {
      "desde": "...",
      "hasta": "...",
      "tramos": [{"min": 1, "max": 5, "precio": 100.0}, ...]
    }
    Si no hay descuentoPorCantidad válido, devuelve None.
    """
    dpc = item.get("descuentoPorCantidad")
    if not isinstance(dpc, dict):
        return None

    detalle = dpc.get("detalleDPC")
    if not isinstance(detalle, list) or len(detalle) == 0:
        return None

    tramos = []
    for row in detalle:
        if not isinstance(row, dict):
            continue
        mn = row.get("franjaDesde")
        mx = row.get("franjaHasta")
        pr = row.get("precio")

        try:
            mn = int(mn)
        except Exception:
            continue

        # max puede venir null / vacío: lo abrimos "infinito"
        try:
            mx = int(mx) if mx is not None else 999999999
        except Exception:
            mx = 999999999

        try:
            pr = float(pr)
        except Exception:
            continue

        tramos.append({"min": mn, "max": mx, "precio": pr})

    if not tramos:
        return None

    tramos.sort(key=lambda x: x["min"])

    return {
        "desde": dpc.get("fechaDesde"),
        "hasta": dpc.get("fechaHasta"),
        "tramos": tramos
    }

def fetch_changes(fecha_desde, hora_desde):
    if not BASE_URL or not ID_EMPRESA or not ID_LOCAL or not USER or not PASS:
        die("Faltan variables de entorno: API_BASE_URL, API_ID_EMPRESA, API_ID_LOCAL, API_USER, API_PASS")

    headers = {
        "Accept": "application/json",
        "Authorization": basic_auth_header(USER, PASS),
    }

    all_items = []
    skip = 0

    while True:
        # ✅ URL correcta: BASE_URL ya incluye .../products.api...rest.server
        url = (
            f"{BASE_URL}/api/minoristas/{ID_EMPRESA}"
            f"/locales/{ID_LOCAL}/precios"
            f"?fechaDesde={fecha_desde}&horaDesde={hora_desde}&skip={skip}&take={TAKE}"
        )

        r = requests.get(url, headers=headers, timeout=60)
        if r.status_code != 200:
            die(f"Error API {r.status_code}: {r.text[:300]}")

        data = r.json()

        # La API puede devolver array directo o wrapper
        if isinstance(data, list):
            items = data
        else:
            items = data.get("items") or data.get("data") or data.get("content") or []

        if not isinstance(items, list):
            die("Respuesta inesperada: no es lista de productos.")

        all_items.extend(items)

        if len(items) < TAKE:
            break

        skip += TAKE

    return all_items

def merge_product(existing, incoming):
    out = dict(existing)

    # Campos "seguros" de pisar
    for k in ["name", "barcode", "scanntechId", "currency", "stockOnline", "precioRegular", "precioOferta", "offer", "price"]:
        if incoming.get(k) is not None and incoming.get(k) != "":
            out[k] = incoming[k]

    # ✅ Promo por cantidad: si viene, pisa; si no viene, NO toca lo que ya exista.
    if incoming.get("dpc") is not None:
        out["dpc"] = incoming["dpc"]

    out["updatedAt"] = incoming.get("updatedAt")
    return out

def main():
    state = load_json(STATE_FILE, {"fechaDesde": "2026-01-01", "horaDesde": "00:00:00"})
    products = load_json(PRODUCTS_FILE, [])

    if not isinstance(products, list):
        die("products.json debe ser un array")

    fecha_desde = state.get("fechaDesde", "2026-01-01")
    hora_desde = state.get("horaDesde", "00:00:00")

    print("Sync desde:", fecha_desde, hora_desde)

    changes = fetch_changes(fecha_desde, hora_desde)
    print("Cambios recibidos:", len(changes))

    index = {}
    for i, p in enumerate(products):
        key = str(p.get("scanntechId") or p.get("codigoInterno") or p.get("id") or "").strip()
        if key:
            index[key] = i

    created = 0
    updated = 0
    now_iso = datetime.datetime.utcnow().isoformat() + "Z"

    for it in changes:
        sc_id = str(it.get("codigoInterno") or "").strip()
        if not sc_id:
            continue

        dpc_parsed = parse_dpc(it)

        incoming = {
            "scanntechId": sc_id,
            "barcode": pick_barcode(it),
            "name": (it.get("descripcionCorta") or it.get("descripcion") or "").strip(),
            "price": pick_price(it),
            "offer": bool(it.get("esPrecioOferta")),
            "precioRegular": it.get("precioRegular") if isinstance(it.get("precioRegular"), (int, float)) else None,
            "precioOferta": it.get("precioOferta") if isinstance(it.get("precioOferta"), (int, float)) else None,
            "stockOnline": it.get("stockOnline") if isinstance(it.get("stockOnline"), (int, float)) else None,
            "currency": it.get("moneda"),
            "dpc": dpc_parsed,  # ✅ promos por cantidad
            "updatedAt": now_iso,
        }

        if sc_id in index:
            products[index[sc_id]] = merge_product(products[index[sc_id]], incoming)
            updated += 1
        else:
            # Nuevo: campos mínimos, conservador
            prod_new = {
                "id": sc_id,
                "scanntechId": sc_id,
                "name": incoming["name"],
                "price": incoming["price"],
                "offer": incoming["offer"],
                "barcode": incoming["barcode"],
                "currency": incoming["currency"],
                "stockOnline": incoming["stockOnline"],
                "precioRegular": incoming["precioRegular"],
                "precioOferta": incoming["precioOferta"],
                "category": "Sin categoría",
                "subcategory": "",
                "img": "",
                "updatedAt": incoming["updatedAt"],
            }
            if incoming.get("dpc") is not None:
                prod_new["dpc"] = incoming["dpc"]

            products.append(prod_new)
            index[sc_id] = len(products) - 1
            created += 1

    save_json(PRODUCTS_FILE, products)

    f, h = now_utc_parts()
    save_json(STATE_FILE, {"fechaDesde": f, "horaDesde": h})

    print(f"Listo. Nuevos: {created} | Actualizados: {updated}")

if __name__ == "__main__":
    main()
