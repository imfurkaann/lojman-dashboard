# Database and Migration Notes

## Engine
- better-sqlite3
- WAL mode aktif
- foreign_keys pragma aktif

## Temel Tablolar
- users
- rooms
- room_issues
- room_inventory
- personnel
- personnel_complaints
- entry_exit_list
- activity_log
- shared_equipment
- visitors
- fire_alarms
- equipment_items
- inventory_mutations
- handover_forms
- personnel_inventory
- room_stay_history

## Startup Davranisi
- initDatabase() tablo olusumlarini calistirir.
- Varsayilan admin kullanici olusturulur (username: admin).
- Ardindan runMigrations() cagrilir.

## Migration Davranis Ozet
- Bazi migrationlar tabloyu yeni tabloya kopyalayip eski tabloyu drop ediyor.
- room_inventory ve rooms benzeri tablolar icin sema donusumleri mevcut.
- personnel tablosuna cok sayida alan sonradan eklenmis.
- entry_exit_list, room_issues, room_inventory ve personnel uzerinde alan ekleme ve backfill islemleri var.

## Kritik Riskler
- Drop/Rename bazli migrationlar transaction disinda kalirsa veri kaybi riski olusur.
- Schema version tablosu bulunmadigi icin migration idempotency takibi zor.
- TC ile ilgili gecislerde plain/encrypted alanlarin birlikte varligi sorgu karmasasi yaratabilir.

## Debug Checklist
1. DB_PATH degerini kontrol et (local ve docker farkli olabilir).
2. sqlite dosyasinin yazilabilir oldugunu dogrula.
3. Startup loglarinda migration mesajlarini incele.
4. room_inventory ve personnel semasini PRAGMA table_info ile dogrula.
5. En kritik akislar icin transaction gereksinimini degerlendir.
