# Release Android APK (Capacitor)

## Requisitos
- Node.js 18+
- Android Studio + Android SDK
- JDK 17 (recomendado para AGP moderno)

## Flujo recomendado (repo aislado)
```bash
./scripts/prepare-android-repo.sh
cd ../mayorista-makabra-android
```

## Build web + sincronización
```bash
npm install
npm run build:android
npm run android:init
npm run android:sync
```

## Abrir Android Studio
```bash
npm run android:open
```

## APK Debug
```bash
cd android
./gradlew assembleDebug
```
APK generado:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

## APK Release (firmada)

### 1) Generar keystore
```bash
keytool -genkeypair -v -keystore mayorista-makabra.jks -alias mayorista -keyalg RSA -keysize 2048 -validity 10000
```

### 2) Configurar signing (NO subir al repo)
Crear `android/gradle.properties` (en el repo generado) con:
```
MYAPP_STORE_FILE=/ruta/completa/mayorista-makabra.jks
MYAPP_STORE_PASSWORD=tu_password
MYAPP_KEY_ALIAS=mayorista
MYAPP_KEY_PASSWORD=tu_password
```

Editar `android/app/build.gradle` y agregar:
```gradle
android {
  signingConfigs {
    release {
      storeFile file(MYAPP_STORE_FILE)
      storePassword MYAPP_STORE_PASSWORD
      keyAlias MYAPP_KEY_ALIAS
      keyPassword MYAPP_KEY_PASSWORD
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
      minifyEnabled false
      shrinkResources false
    }
  }
}
```

### 3) Compilar release
```bash
cd android
./gradlew assembleRelease
```
APK generado:
```
android/app/build/outputs/apk/release/app-release.apk
```

## Google Sheets / Catálogo
- Endpoint se configura en `PRODUCTS_URL` (data.js).
- Si el fetch falla, se usa el último catálogo guardado en `localStorage`.
- La app muestra un aviso no invasivo cuando está usando caché.

## Troubleshooting
- **No carga catálogo:** verificá que la Sheet esté publicada como CSV y sea pública.
- **CORS en Android WebView:** usar el link de publicación CSV, evitar links privados.
- **Assets rotos en Android:** asegurar build con `VITE_BASE=./` (script `build:android`).

## Checklist
- [ ] `npm run build:android`
- [ ] `npm run android:init`
- [ ] `npm run android:sync`
- [ ] Debug APK generado
- [ ] Keystore guardado fuera del repo
- [ ] Release APK generado
