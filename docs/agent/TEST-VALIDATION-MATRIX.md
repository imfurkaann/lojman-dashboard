# ✅ TEST VALIDATION MATRIX

Use this matrix to validate that fixes work correctly.

---

## MODULE 1: Authentication & Session

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| AUTH-1 | Login Success | 1. POST /login {user:admin, pass:admin} 2. Check session.user set 3. Redirect /dashboard | Session.user.id exists, role='admin' | Login fails, session empty |
| AUTH-2 | Invalid Credentials | POST /login {user:admin, pass:wrong} | Redirect to login, 401 error shown | Accepts wrong password |
| AUTH-3 | Session Persistence | 1. Login 2. Reload /personel 3. Check user still set | Page loads, user.full_name shown | 404 or logout |
| AUTH-4 | Logout | 1. Login 2. POST /logout 3. Try /personel | Redirects to /login | Can still access protected |
| AUTH-5 | Role-Based Access | Login as user_role=user, try POST /users | Denied (403 or redirect) | User can modify users |
| AUTH-6 | No Session | Direct browser to /personel without login | Redirects to /login | Loads page (auth bypass) |

---

## MODULE 2: Personel Management

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| PER-1 | Add Personnel | POST /personel/ekle {first_name, last_name, phone, gender} | Created, redirects /personel, new entry in table | Error 500 or missing fields |
| PER-2 | Add with Photo | POST /personel/ekle + file upload (JPEG 5MB) | Photo saved in public/uploads/personnel/, DB path set | 404 photo path or upload fails |
| PER-3 | List Personnel | GET /personel page | Shows table with all personnel, status badges | Empty table or 500 error |
| PER-4 | View Detail | Click person → GET /personel/{id} | Detail page loads, tabs visible (Kişisel, Teslimat, Geçmiş, Şikayetler) | 404 or blank page |
| PER-5 | Edit Personnel | Edit first_name → POST /personel/{id}/guncelle | Changes saved, redirect /personel/{id}, new value shown | Changes not saved, error |
| PER-6 | Delete Personnel | POST /personel/{id}/sil | Deleted, redirects /personel, gone from list | 500 error, still in list |
| PER-7 | Status Badge | Person status=aktif | Badge shows green "Aktif" | Wrong status or no badge |
| PER-8 | TC Encryption | Add person with TC number | Stored encrypted in DB, shown as *******XXXX | Stored plain text, TC exposed |

---

## MODULE 3: Room Assignment & Management

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| ROOM-1 | Assign Room | Person status=bosta → Assign to Oda 101 | Person.room_id set, status→aktif, key_qty decrements, redirect detail | Person not assigned, keys not updated |
| ROOM-2 | Key Stock Sync | Oda 101 keys=10 → Assign 5 people | Key count shows 5 remaining (10-5) | Keys still 10, negative possible |
| ROOM-3 | Capacity Check | Oda capacity=2 → Try assign 3rd person | Reject "Oda dolmuş" error | Allows over-capacity |
| ROOM-4 | Room List | GET /odalar | Shows all rooms with occupancy (X/capacity) | Empty list, 404, or wrong counts |
| ROOM-5 | Cleaning Override | Room status=temizlenmeli → Try assign without override | Show confirm dialog "temizlenmesi gerekiyor" | No dialog, or allows straight |
| ROOM-6 | Availability Status | Set Oda 101 availability='kullanilamaz' → Try assign | Reject "oda kullanılamaz" | Allows assignment |
| ROOM-7 | Inventory View | GET /odalar/{id} → Tab "Demirbaş" | Show inventory items with condition (sağlam, eksik, arızalı) | No tab, empty inventory |

---

## MODULE 4: Zimmet (Handover) & Checkout

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| ZIM-1 | Entry Handover | Assign room → Shows "Giriş Teslimatları" key + items | Key & items checked by default, items toggleable | No items shown |
| ZIM-2 | Broken Item Report | Item "not delivered" → Select tag "arızalı" → description | Room issue created, pending in list | No issue created |
| ZIM-3 | Checkout Modal | Click "Çıkış Yap" on active person | Checkout modal shows all inventory items, radios required | Modal doesn't open |
| ZIM-4 | Checkout Form Save | Select "Teslim Alındı" for all items → Submit | Checkout payload saved, person.status='cikis_yapti' | Data not saved |
| ZIM-5 | Key Return | Checkout → Uncheck key "Teslim Alındı" → Submit | checkout_key_returned=0 saved | Always saved as returned |
| ZIM-6 | Reassign Room | Exited person → "Oda Ata" → select new room | Reassign modal shows pending issues for new room | Doesn't show issues |
| ZIM-7 | Resolve Issue | Reassign → mark broken item as "Sağlam Teslim Edildi" → confirm | Calls /odalar/{id}/demirbas-sorun-coz, issue resolved | Modal closes, issue not resolved |
| ZIM-8 | Final Reassign | Complete reassign form + zimmet signed + key delivered → submit | Person re-activated, new room assigned, status='aktif' | Job hangs, form doesn't submit |

---

## MODULE 5: Oda Issues & Inventory

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| ISSUE-1 | Report Problem | Oda detail → "Sorun Ekle" → title, desc, tag | Issue created, shows in problem list | 500 error, not saved |
| ISSUE-2 | Issue Priority | Tag="arızalı" (high) vs "diger" (low) | Both show in list, sortable by status | Lost issues or no tag |
| ISSUE-3 | Mark Resolved | Open issue → status changed to 'cozuldu' | Issue moves to resolved section, resolved_at timestamp | Doesn't update status |
| ISSUE-4 | Inventory Condition | Issue for "Oda Anahtarı" arızalı → Check inventory condition | room_inventory.condition='arizali' | Stays 'saglam' |
| ISSUE-5 | Multiple Issues Same Item | Add 2 issues for same item → resolve 1 → check inventory | Inventory condition matches latest open issue | Both resolve, or wrong condition |

---

## MODULE 6: Reports & Export

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| REP-1 | Personnel Report | GET /raporlar/personel | Shows table with ID, name, status, room | Blank page, 500 error |
| REP-2 | Filter Report | Add search filter name="Ali" | Only entries with "Ali" shown | No filter effect |
| REP-3 | Export to Excel | Click "Excel İndir" on report | Download file.xlsx, can open in Excel | 404, corrupt file, timeout |
| REP-4 | Room Report | GET /raporlar/odalar | Shows rooms with occupancy, condition | Blank, 500 error |
| REP-5 | Issue Report | GET /raporlar/sorunlar | Shows active & resolved issues | Blank, missing issues |
| REP-6 | Pagination | 100+ entries → check pagination controls | Prev/Next buttons, page count correct | All on 1 page or infinite loop |

---

## MODULE 7: Socket.IO Real-Time Updates

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| SOCKET-1 | Connection | Open /personel, check Network tab | WebSocket connection established to /socket.io | No connection attempted |
| SOCKET-2 | Personnel Refresh | Open /personel in 2 browsers → Add person in browser 1 → Check browser 2 | Browser 2 instantly shows new person | Manual refresh needed |
| SOCKET-3 | Room Update | Add person to Oda 101 in browser 1 → Check room count in browser 2 /odalar | Oda 101 occupancy updates live | Browser 2 stale |
| SOCKET-4 | Docker Network | Run in Docker → Open browser on host → Check socket | WebSocket connects successfully | Connection refused, blocked |

---

## MODULE 8: Database & Data Integrity

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| DB-1 | Foreign Keys | Add personnel with invalid room_id | Rejected, foreign key constraint | Allows orphan record |
| DB-2 | Unique Constraints | Add 2 users with same username | Rejected, unique violation | Both created, duplicate users |
| DB-3 | On Delete Cascade | Delete room 101 → Check personnel | Personnel?room_id should be NULL or deleted | Orphan records |
| DB-4 | Transaction Rollback | Assign person + key sync in transaction → simulate error | Both changes rollback, no partial state | Partial update, inconsistent |
| DB-5 | Data Export | sqlite3 lojman.db .dump > backup.sql | Backup works, can restore | Corrupt dump, can't restore |

---

## MODULE 9: Performance & Scalability

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| PERF-1 | 100 Personnel Load | Create 100 people, open /personel | Page loads < 2 seconds | > 5 seconds, memory leak |
| PERF-2 | Large Export | Export 1000+ entries to Excel | Completes < 30 seconds | Timeout 502, memory spike |
| PERF-3 | Room List | 100 rooms open /odalar | Renders < 1 second | Hangs, stale DOM |
| PERF-4 | Report Filter | 10k entries, filter by department | Filter results < 1 second | Stalls, unresponsive |

---

## MODULE 10: Docker Deployment

| Test ID | Flow | Test Steps | Expected | ❌ Fail = |
|---------|------|----------|----------|---------|
| DOCKER-1 | Build | docker compose build | Build completes, image created | Build fails, missing deps |
| DOCKER-2 | Start | docker compose up -d | Container starts, logs clean | Container exit, error logs |
| DOCKER-3 | DB Mount | Check /data/lojman.db in container | DB file exists, writable | Permissions error, DB lost |
| DOCKER-4 | Port Mapping | Browser http://localhost:3000 | App loads | Connection refused |
| DOCKER-5 | Persistence | Add data → docker compose down/up → Check data | Data persists | Data lost, fresh start |
| DOCKER-6 | Logs | docker logs lojman-dashboard | Shows startup logs, migrations | Logs empty or truncated |

---

## How to Use This Matrix

1. **Pick a module** (e.g., "MODULE 3: Room Assignment")
2. **Run each test case** in sequence
3. **Mark result**: ✅ Pass or ❌ Fail
4. **If fail**: Use CRITICAL-BUGS-DETAILED.md to debug
5. **Document findings** in bug tracker
6. **Re-test after fix**

## Sample Test Run

```bash
# Start fresh
docker compose down && docker compose up -d --build

# Test AUTH-1
curl -c /tmp/cookies.txt -d "username=admin&password=admin" http://localhost:3000/login -v

# Test PER-1
curl -b /tmp/cookies.txt -d "first_name=Ali&last_name=Veli&phone=05551234567&gender=erkek" \
  http://localhost:3000/personel/ekle -v

# Test ROOM-1
curl -b /tmp/cookies.txt -d "new_room_id=1" http://localhost:3000/personel/1/oda-degistir -v

# Verify in browser
open http://localhost:3000/personel/1
```

