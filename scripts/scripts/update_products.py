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
    # Guardamos UTC para evitar líos de zona horaria en GitHub Actions
    d = datetime.datetime.utcnow()
    return d.strftime("%Y-%m-%d"), d.strftime("%H:%M:%S")

def pick_barcode(item):
    cbs = item.get("codigosDeBarras")
    if isinstance(cbs, list) and len(cbs) > 0:
        return str(cbs[0])
    return ""

def pick_price(item):
    # Si hay oferta => precioOferta, si no => precioRegular
    es_oferta = bool(item.get("esPrecioOferta"))
    if es_oferta and isinstance(item.get("precioOferta"), (int, float)):
        return item["precioOferta"]
    if isinstance(item.get("precioRegular"), (int, float)):
        return item["precioRegular"]
    return None

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
        url = (
            f"{BASE_URL}/products.api.servicios.backend.rest.server/api/minoristas/{ID_EMPRESA}"
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
            items = data.get("items") or data.get("data") or []

        if not isinstance(items, list):
            die("Respuesta inesperada: no es lista de productos.")

        all_items.extend(items)

        if len(items) < TAKE:
            break

        skip += TAKE

    return all_items

def merge_product(existing, incoming):
    # Merge conservador: NO pisa category/subcategory/img si no vienen
    out = dict(existing)

    for k in ["name", "barcode", "scanntechId", "currency", "stockOnline", "precioRegular", "precioOferta", "offer", "price"]:
        if incoming.get(k) is not None and incoming.get(k) != "":
            out[k] = incoming[k]

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

    # Index por scanntechId / codigoInterno / id
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
            "updatedAt": now_iso,
        }

        if sc_id in index:
            products[index[sc_id]] = merge_product(products[index[sc_id]], incoming)
            updated += 1
        else:
            # Nuevo: campos mínimos, conservador
            products.append({
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
            })
            index[sc_id] = len(products) - 1
            created += 1

    save_json(PRODUCTS_FILE, products)

    # Avanza estado para próxima corrida
    f, h = now_utc_parts()
    save_json(STATE_FILE, {"fechaDesde": f, "horaDesde": h})

    print(f"Listo. Nuevos: {created} | Actualizados: {updated}")

if __name__ == "__main__":
    main()
