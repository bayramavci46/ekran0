# Android imza anahtarı

`kurgu-masasi.p12`, Android uygulamasının sürümlerini imzalayan anahtardır. Android bir güncellemeyi yalnızca
aynı anahtarla imzalanmışsa kabul eder; bu yüzden anahtar hep aynı kalmalıdır.

Dosya güçlü bir parolayla şifrelidir (PKCS12, AES-256). Parola depoda değildir: GitHub'da
**Settings → Secrets and variables → Actions** bölümüne `ANDROID_KEYSTORE_PASSWORD` adıyla eklenir.
Derleme iş akışı (`.github/workflows/apps.yml`) parolayı oradan alır. Parola eklenmemişse o derleme için geçici
bir anahtar kullanılır; o sürümden sonrakine geçerken uygulamayı silip yeniden kurmak gerekir.

Parolayı bir parola yöneticisinde de saklayın: Google Play'e yüklemek isterseniz aynı anahtar gerekir.
