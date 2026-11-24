# Senada — Pemutar Musik Offline

Senada adalah aplikasi web yang dapat dipasang di ponsel. File musik, playlist, dan riwayat putar disimpan di penyimpanan lokal browser, tidak dikirim ke server.

## Memulai

1. Publikasikan isi folder ini ke hosting statis yang menggunakan HTTPS.
2. Buka alamat aplikasi di ponsel selagi online, lalu tunggu sampai aplikasi selesai dimuat.
3. Pilih **Unggah musik** untuk menyimpan lagu ke perangkat.
4. Tambahkan aplikasi ke layar utama dari menu browser agar mudah dibuka seperti aplikasi biasa.
5. Setelah itu, lagu dan aplikasi tetap bisa dibuka tanpa koneksi internet.

Service worker membutuhkan HTTPS (atau `localhost`). Membuka `index.html` sebagai file biasa tidak mengaktifkan mode offline. Musik disimpan terpisah di penyimpanan browser pada perangkat yang digunakan; unggah ulang jika ingin mendengarkannya di perangkat lain.
