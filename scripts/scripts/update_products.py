#!/usr/bin/env python3
# update_products.py — Scanntech (API Etiquetas) → public/products.json
# ✅ Headers: idEmpresa / idLocal + Basic Auth
# ✅ Incremental por fechaDesde (ISO)
# ✅ Ventana de seguridad (SAFETY_SECONDS) para no perder cambios
# ✅ Precio robusto (precioOferta/precioRegular)
# ✅ DPC seguro: solo borra si el campo vino explícitamente null
# ✅ Idempotente: no escribe si no hay cambios reales (hash)
# ✅ Orden estable por id para hash estable

import os
import json
import base64
import datetime
import hashlib
import requests
from typing import Any, Dict, List, Optional, Tuple


# ----------------------------
# Configuración (ENV)
# ----------------------------
BASE_URL = os.environ.get("API_BASE_URL", "http://mobile.scanntech.com").rstrip("/")
ID_EMPRESA = os.environ.get("API_ID_EMPRESA", "")
ID_LOCAL = os.environ.get("API_ID_LOCAL", "")
USER = os.environ.get("API_USER", "")
PASS = os.environ.get("API_PASS", "")

PRODUCTS_FILE = os.environ.get("PRODUCTS_FILE", "public/products.json")
STATE_FILE = os.environ.get("STATE_FILE", "last_sync.json")

# Endpoint: configurable (IMPORTANT)
ENDPOINT_PATH = os.environ.get("SCANNTECH_ENDPOINT_PATH", "/api/v1/articulos/cambios")

TIMEOUT = int(os.environ.get("TIMEOUT", "30"))
SAFETY_SECONDS = int(os.environ.get("SAFETY_SECONDS", "120"))


# ----------------------------
# Helpers
# ----------------------------
def die(msg: str) -> None:
    print(f"❌ {msg}")
    raise SystemExit(1)


def load_json(path: str, default: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def basic_auth_header(user: str, pwd: str) -> str:
    token = base64.b64encode(f"{user}:{pwd}".encode("utf-8")).decode("utf-8")
    return f"Basic {token}"


def now_utc_iso_safe() -> str:
    # ISO sin zona, típico: YYYY-MM-DDTHH:mm:ss
    d = datetime.datetime.utcnow() - datetime.timedelta(seconds=SAFETY_SECONDS)
    return d.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%S")


def calculate_hash(obj: Any) -> str:
    dump = json.dumps(obj, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return hashlib.md5(dump.encode("utf-8")).hexdigest()


def to_float(x: Any) -> Optional[float]:
    try:
        if x is None:
            return None
        if isinstance(x, (int, float)) and not isinstance(x, bool):
            return float(x)
        s = str(x).strip().replace("$", "").replace(".", "").replace(",", ".")
        return float(s) if s else None
    except Exception:
        return None


def to_int(x: Any) -> Optional[int]:
    try:
        if x is None or isinstance(x, bool):
            return None
        if isinstance(x, int):
            return x
        if isinstance(x, float):
            return int(x)
        s = str(x).strip()
        return int(float(s)) if s else None
    except Exception:
        return None


def stable_key(p: Dict[str, Any]) -> str:
    return str(p.get("id") or p.get("scanntechId") or "").strip()


# ----------------------------
# Scanntech fetch (API Etiquetas)
# ----------------------------
def fetch_changes(fecha_desde_iso: str) -> List[Dict[str, Any]]:
    if not BASE_URL or not ID_EMPRESA or not ID_LOCAL or not USER or not PASS:
        die("Faltan variables de entorno: API_BASE_URL, API_ID_EMPRESA, API_ID_LOCAL, API_USER, API_PASS")

    url = f"{BASE_URL}{ENDPOINT_PATH}"

    headers = {
        "Accept": "application/json",
        "Authorization": basic_auth_header(USER, PASS),
        "idEmpresa": ID_EMPRESA,
        "idLocal": ID_LOCAL,
    }

    params = {"fechaDesde": fecha_desde_iso}

    print(f"📡 Consultando Scanntech: {url}")
    print(f"   Desde: {fecha_desde_iso}")

    try:
        r = requests.get(url, headers=headers, params=params, timeout=TIMEOUT)
        if r.status_code != 200:
            die(f"Error API {r.status_code}: {r.text[:200]}")

        data = r.json()

        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("items") or data.get("articulos") or data.get("cambios") or data.get("results") or []
        else:
            items = []

        if not isinstance(items, list):
            die("Respuesta inesperada: no es lista de cambios.")

        print(f"✅ Recibidos {len(items)} cambios.")
        return items

    except Exception as e:
        die(f"Error de conexión: {e}")


# ----------------------------
# Precio (robusto)
# ----------------------------
def pick_price(item: Dict[str, Any]) -> Optional[float]:
    es_oferta = bool(item.get("esPrecioOferta"))
    po = to_float(item.get("precioOferta"))
    pr = to_float(item.get("precioRegular"))

    if es_oferta and po is not None:
        return po
    if pr is not None:
        return pr

    # fallback por si usan otro nombre
    return to_float(item.get("precioVigente"))


# ----------------------------
# DPC (seguro)
# ----------------------------
def parse_dpc(item: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """
    Devuelve (present, value)
    - present=False: NO vino la key -> no tocar DPC existente
    - present=True y value=None: vino explícitamente null/vacío -> borrar DPC
    - present=True y value=dict: promo válida -> pisar DPC
    """
    if "descuentoPorCantidad" not in item:
        return False, None

    dpc = item.get("descuentoPorCantidad")
    if dpc is None:
        return True, None

    if not isinstance(dpc, dict):
        return True, None

    detalle = dpc.get("detalleDPC")
    if not isinstance(detalle, list) or not detalle:
        return True, None

    tramos = []
    for row in detalle:
        if not isinstance(row, dict):
            continue

        # Algunos PDFs usan "cantidad", otros "franjaDesde/franjaHasta"
        mn = to_int(row.get("cantidad") or row.get("franjaDesde"))
        mx = row.get("franjaHasta")
        mx = to_int(mx) if mx is not None else None
        pr = to_float(row.get("precio"))

        if mn is None or pr is None:
            continue

        # Si no hay max, dejamos infinito
        if mx is None:
            tramos.append({"min": mn, "max": 999999999, "precio": pr})
        else:
            tramos.append({"min": mn, "max": mx, "precio": pr})

    if not tramos:
        return True, None

    tramos.sort(key=lambda x: x["min"])

    # Formato compatible con tu data.js (acepta max) y con el frontend
    return True, {
        "desde": dpc.get("fechaDesde"),
        "hasta": dpc.get("fechaHasta"),
        "tramos": tramos,
    }


# ----------------------------
# Merge (compatibilidad frontend)
# ----------------------------
def merge_product(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(existing)

    # Actualizamos campos base
    if incoming.get("name"):
        out["name"] = incoming["name"]
        # si tu frontend usa nombre, mantenemos espejo
        out["nombre"] = incoming["name"]

    if incoming.get("price") is not None:
        out["price"] = incoming["price"]
        out["precio"] = incoming["price"]  # espejo

    out["offer"] = bool(incoming.get("offer"))
    out["oferta"] = bool(incoming.get("offer"))  # espejo

    if incoming.get("stock") is not None:
        out["stock"] = incoming["stock"]

    if incoming.get("updatedAt"):
        out["updatedAt"] = incoming["updatedAt"]

    # DPC: solo tocar si se recibió explícitamente el campo
    if incoming.get("_dpc_present") is True:
        if incoming.get("dpc") is not None:
            out["dpc"] = incoming["dpc"]
        else:
            if "dpc" in out:
                del out["dpc"]

    return out


# ----------------------------
# MAIN
# ----------------------------
def main() -> None:
    state = load_json(STATE_FILE, {})
    default_date = (datetime.datetime.utcnow() - datetime.timedelta(days=1)).replace(microsecond=0).strftime("%Y-%m-%dT00:00:00")
    last_sync = state.get("last_sync", default_date)

    products = load_json(PRODUCTS_FILE, [])
    if not isinstance(products, list):
        products = []

    # Hash inicial con orden estable
    products.sort(key=stable_key)
    initial_hash = calculate_hash(products)

    changes = fetch_changes(last_sync)

    if not changes:
        print("💤 Sin cambios.")
        save_json(STATE_FILE, {"last_sync": now_utc_iso_safe()})
        return

    index = {stable_key(p): i for i, p in enumerate(products)}
    now_iso = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    updated_count = 0
    created_count = 0

    for it in changes:
        sc_id = str(it.get("codigoInterno") or it.get("id") or "").strip()
        if not sc_id:
            continue

        dpc_present, dpc_val = parse_dpc(it)

        incoming = {
            "id": sc_id,
            "name": str(it.get("descripcion") or it.get("descripcionCorta") or "").strip(),
            "price": pick_price(it),
            "offer": bool(it.get("esPrecioOferta")),
            "stock": to_float(it.get("stock") or it.get("stockOnline")),
            "updatedAt": now_iso,
            "_dpc_present": dpc_present,
            "dpc": dpc_val,
        }

        if sc_id in index:
            idx = index[sc_id]
            products[idx] = merge_product(products[idx], incoming)
            updated_count += 1
        else:
            # Nuevo producto: formato mínimo compatible (mantiene espejos)
            price_val = incoming["price"] if incoming["price"] is not None else 0
            new_prod = {
                "id": sc_id,
                "scanntechId": sc_id,
                "name": incoming["name"] or sc_id,
                "nombre": incoming["name"] or sc_id,
                "price": price_val,
                "precio": price_val,
                "offer": incoming["offer"],
                "oferta": incoming["offer"],
                "category": "Nuevos",
                "categoria": "Nuevos",
                "subcategory": "",
                "subcategoria": "",
                "img": "",          # tu UI actual soporta img
                "imagen": "",       # espejo por compatibilidad
                "imagen_url": "",   # por si algún flujo lo usa
                "stock": incoming["stock"] if incoming["stock"] is not None else 0,
                "destacado": False,
                "updatedAt": now_iso,
            }
            if dpc_present and dpc_val is not None:
                new_prod["dpc"] = dpc_val

            products.append(new_prod)
            index[sc_id] = len(products) - 1
            created_count += 1

    # Guardado idempotente
    products.sort(key=stable_key)
    final_hash = calculate_hash(products)

    if initial_hash != final_hash:
        save_json(PRODUCTS_FILE, products)
        print(f"✅ Guardado {PRODUCTS_FILE} | nuevos={created_count} | actualizados={updated_count}")
    else:
        print("✅ Sin cambios reales (hash igual). No se escribe products.json.")

    save_json(STATE_FILE, {"last_sync": now_utc_iso_safe()})
    print(f"🕒 Estado guardado en {STATE_FILE}: {now_utc_iso_safe()}")


if __name__ == "__main__":
    main()
