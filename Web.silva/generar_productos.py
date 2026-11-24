import csv
import ipaddress
import json
import socket
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "productos.js"
REQUIRED_COLUMNS = {"id", "nombre", "categoria", "precio"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".jfif"}
DEFAULT_BACKGROUNDS = {
    "Herramientas": "#f0e9d8",
    "Electricidad": "#f0edda",
    "Plomería": "#e2ebeb",
    "Pinturas": "#e5eaf0",
    "Construcción": "#eee8e2",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def validate_image_url(url):
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("La URL de imagen debe comenzar con http:// o https://.")
    if parsed.username or parsed.password:
        raise ValueError("La URL de imagen no debe incluir usuario ni contraseña.")

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as error:
        raise ValueError("La URL de imagen tiene un puerto no válido.") from error
    if port not in {80, 443}:
        raise ValueError("La URL de imagen debe usar el puerto estándar 80 o 443.")

    try:
        addresses = socket.getaddrinfo(
            parsed.hostname, port, type=socket.SOCK_STREAM
        )
    except OSError as error:
        raise ValueError(f"No se pudo resolver el servidor de la imagen: {error}") from error
    if not addresses or any(
        not ipaddress.ip_address(address[4][0]).is_global for address in addresses
    ):
        raise ValueError("La URL de imagen debe apuntar a un servidor público.")


class SafeImageRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        validate_image_url(new_url)
        if request.full_url.startswith("https://") and new_url.startswith("http://"):
            raise ValueError("Se rechazó una redirección de HTTPS a HTTP.")
        return super().redirect_request(
            request, response, code, message, headers, new_url
        )


def image_extension(data):
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    raise ValueError(
        "El enlace no apunta directamente a una imagen JPG, PNG, GIF o WEBP."
    )


def download_product_image(product_id, url):
    validate_image_url(url)
    request = Request(url, headers={"User-Agent": "FerreMaxCatalog/1.0"})
    opener = build_opener(SafeImageRedirectHandler())
    with opener.open(request, timeout=20) as response:
        data = response.read(MAX_IMAGE_BYTES + 1)

    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError(f"La imagen del producto {product_id} supera 10 MB.")

    extension = image_extension(data)
    image_folder = ROOT / "imagenes"
    image_folder.mkdir(exist_ok=True)
    destination = image_folder / f"{product_id}{extension}"
    temporary = image_folder / f"{product_id}{extension}.tmp"
    try:
        temporary.write_bytes(data)
        temporary.replace(destination)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise

    print(f"Imagen descargada para el producto {product_id}: imagenes/{destination.name}")
    return f"imagenes/{destination.name}"


def find_product_image(product_id):
    image_folder = ROOT / "imagenes"
    matches = [
        path
        for path in image_folder.glob(f"{product_id}.*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]
    if len(matches) > 1:
        filenames = ", ".join(path.name for path in matches)
        raise ValueError(
            f"El producto {product_id} tiene varias imágenes posibles: {filenames}. "
            "Deja solo una con ese ID."
        )
    return f"imagenes/{matches[0].name}" if matches else ""


def repair_mojibake(value):
    if "Ã" not in value and "Â" not in value:
        return value
    try:
        return value.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def read_products(source_path):
    with source_path.open("r", encoding="utf-8-sig", newline="") as source:
        header = source.readline()
        source.seek(0)
        matching_delimiters = [
            delimiter
            for delimiter in ",;\t"
            if REQUIRED_COLUMNS.issubset(
                {
                    field.strip().lower()
                    for field in next(csv.reader([header], delimiter=delimiter), [])
                }
            )
        ]
        if len(matching_delimiters) != 1:
            raise ValueError(
                "No se pudo identificar el separador del CSV. Usa coma, punto y coma o tabulación."
            )

        reader = csv.DictReader(source, delimiter=matching_delimiters[0])
        reader.fieldnames = [
            field.strip().lower() if field else field
            for field in (reader.fieldnames or [])
        ]
        columns = set(reader.fieldnames or [])
        missing_columns = REQUIRED_COLUMNS - columns
        if missing_columns:
            raise ValueError(
                "Faltan columnas requeridas: " + ", ".join(sorted(missing_columns))
            )

        products = []
        seen_ids = set()
        missing_images = []
        failed_downloads = []

        for line_number, row in enumerate(reader, start=2):
            if not any((value or "").strip() for value in row.values() if isinstance(value, str)):
                continue
            if None in row:
                raise ValueError(f"La fila {line_number} tiene más columnas de las esperadas.")

            try:
                product_id = int((row["id"] or "").strip())
            except ValueError as error:
                raise ValueError(f"El ID de la fila {line_number} debe ser un número entero.") from error
            if product_id <= 0:
                raise ValueError(f"El ID de la fila {line_number} debe ser mayor que cero.")
            if product_id in seen_ids:
                raise ValueError(f"El ID {product_id} está repetido (fila {line_number}).")
            seen_ids.add(product_id)

            name = repair_mojibake((row["nombre"] or "").strip())
            category = repair_mojibake((row["categoria"] or "").strip())
            image = (row["imagen"] or "").strip().replace("\\", "/")
            if not name or not category:
                raise ValueError(f"La fila {line_number} requiere nombre y categoría.")
            download_failed = False
            if image.lower().startswith(("http://", "https://")):
                image_url = image
                image = find_product_image(product_id)
                if not image:
                    try:
                        image = download_product_image(product_id, image_url)
                    except (OSError, ValueError) as error:
                        failed_downloads.append((line_number, product_id, str(error)))
                        download_failed = True
                        image = ""
            if not image:
                image = find_product_image(product_id)
                if not image and not download_failed:
                    missing_images.append(
                        (line_number, f"producto {product_id}: agrega imagenes/{product_id}.jpg (o .png, .webp, .jfif)")
                    )
            if image:
                image_path = PurePosixPath(image)
                if image_path.is_absolute() or ".." in image_path.parts:
                    raise ValueError(
                        f"La ruta de imagen de la fila {line_number} debe ser relativa y no salir de la carpeta del sitio."
                    )
                if not (ROOT / Path(*image_path.parts)).is_file():
                    missing_images.append((line_number, image))

            try:
                price_text = (row["precio"] or "").strip()
                price_text = price_text.replace("S/", "").replace(",", "").strip()
                price = Decimal(price_text)
            except InvalidOperation as error:
                raise ValueError(f"El precio de la fila {line_number} no es válido.") from error
            if not price.is_finite() or price < 0:
                raise ValueError(f"El precio de la fila {line_number} debe ser cero o mayor.")
            price_value = int(price) if price == price.to_integral_value() else float(price)

            background = (row.get("fondo") or "").strip()
            if background and (
                len(background) != 7
                or not background.startswith("#")
                or any(char not in "0123456789abcdefABCDEF" for char in background[1:])
            ):
                raise ValueError(
                    f"El fondo de la fila {line_number} debe ser un color hexadecimal como #f0e9d8."
                )

            products.append(
                {
                    "id": product_id,
                    "name": name,
                    "category": category,
                    "price": price_value,
                    "image": image,
                    "badge": repair_mojibake((row.get("etiqueta") or "").strip()),
                    "bg": background or DEFAULT_BACKGROUNDS.get(category, "#f0e9d8"),
                }
            )

    if not products:
        raise ValueError("El catálogo no contiene productos.")
    return products, missing_images, failed_downloads


def main():
    try:
        if len(sys.argv) > 2:
            raise ValueError("Uso: python generar_productos.py [archivo.csv]")
        if len(sys.argv) == 2:
            source_path = Path(sys.argv[1])
            if not source_path.is_absolute():
                source_path = ROOT / source_path
        else:
            source_path = next(
                (
                    path
                    for path in (ROOT / "productos.csv", ROOT / "productos_OF.csv")
                    if path.is_file()
                ),
                ROOT / "productos.csv",
            )
        products, missing_images, failed_downloads = read_products(source_path)
        content = "window.FERREMAX_PRODUCTS = "
        content += json.dumps(products, ensure_ascii=False, indent=2)
        content += ";\n"
        OUTPUT.write_text(content, encoding="utf-8")
    except (OSError, csv.Error, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print(
        f"Catálogo generado desde {source_path.name}: "
        f"{len(products)} productos en {OUTPUT.name}."
    )
    for line_number, image in missing_images:
        print(f"Aviso: no se encontró la imagen de la fila {line_number}: {image}")
    for line_number, product_id, error in failed_downloads:
        print(
            f"Aviso: el producto {product_id} de la fila {line_number} se agregó, "
            f"pero su imagen no se pudo descargar: {error}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
