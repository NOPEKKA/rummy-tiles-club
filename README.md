# Rummy Tiles Club

เกมฝึกสมองแบบกระเบื้อง 2 เกมในเว็บเดียว เล่นออนไลน์กับเพื่อน หรือฝึกกับบอท (ไทย / English) ใช้เซิร์ฟเวอร์ Firebase ชุดเดียวกัน

**เล่นเลย:** https://nopekka.github.io/rummy-tiles-club/ (เลือกเกมได้ที่หน้าแรก)

### Rummy (แบบ Rummikub)

- โต๊ะกลางเป็นตาราง วางไพ่ช่องไหนก็ได้ ไพ่ที่ติดกันในแถวเดียวกันรวมเป็นชุดให้เอง
- โต๊ะเริ่มแบบซูมเข้า แล้วค่อยๆ ซูมออกเมื่อโต๊ะขยาย
- ต่อเลขข้าม 13 → 1 ได้ (เช่น 12 13 1 2) ปิดได้ในตั้งค่า
- เอฟเฟกต์ตอนวางรวด ต่อไพ่ ขโมยไพ่มาต่อ ชิงโจ๊กเกอร์ และตอนชนะ มีเสียงประกอบ
- สไตล์ไพ่ 4 แบบ: งาช้าง / มนตรา / คริสตัล / ราชสำนัก
- บอร์ดรางไพ่ปรับได้: สูงสุด 15 ช่อง × 4 แถว (60 ช่อง) มีตัวอย่างสด

### ครอสเวิร์ดเลข (Math Crossword)

วางไพ่ตัวเลขกับเครื่องหมายลงกระดาน 15 × 15 แบบครอสเวิร์ด ทุกแถวที่ไพ่ติดกันต้องเป็นสมการที่ถูก

- ไพ่ 100 ตัว: เลข 0–20, + − × ÷, ไพ่เลือกได้ +/− และ ×/÷, = และไพ่ว่าง (เป็นอะไรก็ได้ 0 แต้ม) ในรางมีคนละ 8 ตัว
- เลข 0–9 ต่อกันเป็นเลขได้ถึง 3 หลัก (ห้ามขึ้นต้นด้วย 0) ไพ่ 10–20 ต้องวางเดี่ยว
- × ÷ คิดก่อน + − มี = หลายตัวได้ (เช่น 1+1=2=4÷2) ใส่ − หน้าตัวเลขได้ที่ต้นสมการหรือหลัง =
- ตาแรกต้องผ่านดาวกลางกระดาน ตาต่อไปต้องต่อกับไพ่ที่มีอยู่ และทุกสมการที่เกิดขึ้น (รวมแนวขวาง) ต้องถูก
- คะแนน = แต้มไพ่ × ช่องพิเศษ (เบี้ย ×2/×3, สมการ ×2/×3) ลงครบ 8 ตัวในตาเดียว +40
- เปลี่ยนไพ่ได้เมื่อในถุงเหลือ 5 ตัวขึ้นไป ผ่านติดกันครบ 3 รอบจบเกม จบแล้วแต้มที่ค้างรางติดลบ
- ตั้งเวลาต่อตาได้ (60/90/120/180 วินาที) บอทมี 3 ระดับ (ง่าย/กลาง/ยาก) และนับจำนวนเกมที่ชนะต่อโต๊ะ
- ลากไพ่ หรือแตะไพ่แล้วแตะช่อง ระหว่างวางจะเห็นทันทีว่าสมการถูกไหม และได้กี่แต้ม บนมือถือกดขยายกระดานได้

ถ้ายังไม่ได้ตั้งค่า Firebase หน้าเว็บก็ยังเล่นกับบอทได้ตามปกติ ปุ่มเล่นออนไลน์จะยังกดไม่ได้

---

## วิธีเปิดเซิร์ฟเวอร์ Firebase (ฟรี ประมาณ 10 นาที)

เกมนี้ไม่ต้องรันเซิร์ฟเวอร์เอง: **เบราว์เซอร์ของคนที่เปิดโต๊ะทำหน้าที่เป็นเซิร์ฟเวอร์** คอยตรวจทุกตาที่เล่น ส่วน Firebase Realtime Database เป็นแค่ทางส่งข้อความระหว่างผู้เล่น แพ็กเกจฟรี (Spark) ก็พอ

### 1. สร้างโปรเจกต์

1. เข้า https://console.firebase.google.com แล้วล็อกอินด้วยบัญชี Google
2. กด **Create a project** (หรือ *Add project*) ตั้งชื่อ เช่น `rummy-tiles-club`
3. หน้า Google Analytics ปิดได้เลย (ไม่ได้ใช้) แล้วกด **Create project**

### 2. เปิดการล็อกอินแบบไม่ระบุตัวตน (Anonymous)

ทุกคนจะได้รหัสผู้เล่น (uid) ที่ปลอมไม่ได้ กฎความปลอดภัยใช้รหัสนี้กันโกง

1. เมนูซ้าย **Build → Authentication** → กด **Get started**
2. แท็บ **Sign-in method** → เลือก **Anonymous** → เปิด **Enable** → **Save**
3. แท็บ **Settings → Authorized domains** → **Add domain** → ใส่ `nopekka.github.io`

### 3. สร้างฐานข้อมูล Realtime Database

1. เมนูซ้าย **Build → Realtime Database** → **Create Database**
2. Location เลือก **Singapore (asia-southeast1)** (ใกล้ไทยที่สุด)
3. เลือก **Start in locked mode** → **Enable**
4. ไปแท็บ **Rules** ลบของเดิมออกให้หมด แล้ววางเนื้อหาไฟล์ [`database.rules.json`](database.rules.json) ทั้งไฟล์ → กด **Publish**

> กฎชุดนี้ทำให้ (1) มีแต่โฮสต์ที่เขียนสถานะเกมได้ (2) แต่ละคนเขียนได้เฉพาะในนามตัวเอง (3) ไม่มีใครแก้ข้อมูลส่วนอื่นนอก `rk/` ได้

### 4. เอาค่า config มาใส่เกม

1. กดรูปเฟือง ⚙ ข้าง *Project Overview* → **Project settings**
2. แท็บ **General** เลื่อนลงไป **Your apps** → กดไอคอน **Web** (`</>`)
3. ตั้งชื่อแอป เช่น `rummy-web` (ไม่ต้องติ๊ก Firebase Hosting) → **Register app**
4. จะเห็นโค้ด `const firebaseConfig = { ... }` ให้คัดลอกค่า `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`
   - ถ้าไม่มี `databaseURL` ให้คัดลอกจากหัวหน้า Realtime Database (หน้าตาแบบ `https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app`)
5. เปิดไฟล์ [`docs/firebase-config.js`](docs/firebase-config.js) บน GitHub → กดรูปดินสอ (Edit) → แทนค่า `PASTE_...` ทั้งหมด → **Commit changes**

```js
window.RK_FIREBASE = {
  apiKey: 'AIza....',
  authDomain: 'rummy-tiles-club.firebaseapp.com',
  databaseURL: 'https://rummy-tiles-club-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'rummy-tiles-club',
  appId: '1:1234567890:web:abcdef'
};
```

> ค่าพวกนี้ไม่ใช่รหัสลับ ใส่ในเว็บสาธารณะได้ปกติ ความปลอดภัยมาจาก Rules กับ Anonymous sign-in

### 5. ทดสอบ

1. รอ GitHub Pages อัปเดตประมาณ 1 นาที แล้วเปิด https://nopekka.github.io/rummy-tiles-club/
2. ข้อความ "ยังไม่ได้ตั้งค่า Firebase" ต้องหายไป และปุ่ม **เปิดโต๊ะใหม่** ต้องกดได้
3. กดเปิดโต๊ะ ส่งรหัส 4 ตัวให้เพื่อน ให้เพื่อนเปิดลิงก์เดียวกันแล้วกด **เข้าโต๊ะด้วยรหัส** (หรือกดเข้าจากรายชื่อโต๊ะที่เปิดอยู่)

**ถ้าเจอปัญหา**

| ข้อความในเมนู | แก้ |
|---|---|
| ยังไม่ได้ตั้งค่า Firebase | `docs/firebase-config.js` ยังเป็นค่า `PASTE_...` อยู่ |
| Firebase ยังไม่ได้เปิด Anonymous sign-in | ทำข้อ 2 ให้ครบ |
| ต่อ Firebase ไม่ได้ | ตรวจ `databaseURL` ให้ตรงกับหน้า Realtime Database และกด Publish Rules แล้ว |

### โควตาแพ็กเกจฟรี (Spark)

- คนออนไลน์พร้อมกันได้ 100 คน, เก็บข้อมูล 1 GB, รับส่ง 10 GB/เดือน
- เกมหนึ่งโต๊ะใช้ข้อมูลแค่ไม่กี่ KB
- ถ้าอยากล้างโต๊ะเก่า: Realtime Database → แท็บ **Data** → ลบ `rk/rooms`

---

## ทำงานยังไง

```
ผู้เล่น A (โฮสต์ = เซิร์ฟเวอร์)  ⇄  Firebase Realtime Database  ⇄  ผู้เล่น B, C, D
```

- **โฮสต์** ถือกองไพ่และไพ่ในมือทุกคน ตรวจทุกตาด้วยกติกาเต็ม แล้วเขียนสถานะเกมลง `rk/rooms/{รหัส}/state`
- **ไพ่ในมือ** เข้ารหัสแยกรายคน (ECDH P-256 + AES-GCM) คนอื่นเห็นแค่จำนวนใบ
- **ผู้เล่นคนอื่น** ส่งคำขอ (ลงไพ่ / จั่ว) ไปที่ `acts` โฮสต์อ่านแล้วลบทิ้ง ถ้าผิดกติกาจะตอบกลับผ่าน `err` พร้อมเหตุผล
- **ถ้าโฮสต์ปิดแท็บ** เกมจะหยุดรอ กลับมากด "เล่นต่อ" ก็เล่นต่อได้ ผู้เล่นคนอื่นรีโหลดแล้วกด "เล่นต่อ" ได้เหมือนกัน
- **เวอร์ชัน claude.ai Artifact** ใช้ห้องออนไลน์ของ claude.ai แทน Firebase (โค้ดเดียวกัน เลือกช่องทางให้เอง)

## พัฒนาต่อ

ต้องมี Node 18 ขึ้นไป ไม่ต้องติดตั้งแพ็กเกจเพิ่ม

```bash
npm run build   # src/ → docs/index.html (GitHub Pages) และ dist/rummy-tiles.html (Artifact)
npm test        # unit tests: กติกา, ตารางโต๊ะ, บอร์ด, ตัวตรวจท่า (ต่อ/ขโมย/คอมโบ), ครอสเวิร์ดเลข
```

| ไฟล์ | หน้าที่ |
|---|---|
| `src/rules.js` | กติกา ตรวจชุด ตรวจทั้งตา บอท |
| `src/host.js` | เอนจินของโฮสต์ (ตัวตัดสิน) |
| `src/tablegrid.js` | โต๊ะแบบตาราง วาง/แทรก/ขยาย |
| `src/moveinfo.js` | ดูว่าตานั้นเป็นคอมโบ ต่อไพ่ หรือขโมยไพ่ |
| `src/config.js`, `src/rack.js` | ตั้งค่าบอร์ดรางไพ่ และการจัดไพ่บนราง |
| `src/net.js`, `src/netfb.js` | ออนไลน์: claude.ai room / Firebase |
| `src/fx.js`, `src/sfx.js`, `src/skins.js` | เอฟเฟกต์ เสียง สไตล์ไพ่ |
| `src/mathrules.js` | ครอสเวิร์ดเลข: ไพ่ กระดาน ตรวจสมการ (เศษส่วนแบบตรงเป๊ะ) คิดแต้ม |
| `src/mathbot.js` | บอทครอสเวิร์ดเลข (ค้นหาเป็นช่วงสั้นๆ จอไม่กระตุก) |
| `src/mathhost.js` | เอนจินโฮสต์ของครอสเวิร์ดเลข (ตา ถุงไพ่ เปลี่ยน/ผ่าน ตั้งเวลา จบเกม) |
| `src/mathui.js` | หน้าจอครอสเวิร์ดเลข |
| `src/app.js`, `src/style.css` | เมนู ห้องรอ ตั้งค่า ออนไลน์ และหน้าจอ Rummy |
| `database.rules.json` | กฎความปลอดภัยของ Firebase |

---

### English summary

Two tile games in one page, TH/EN, 2–4 players online or against bots: a Rummikub-style game and Math Crossword (a crossword of true equations on a 15 × 15 board, with bonus squares, choice tiles, blanks, a turn timer and three bot levels). Both share the same online code and Firebase rules. The host's browser is the authority; Firebase Realtime Database only relays messages (anonymous auth + `database.rules.json` stop players writing as someone else or touching the game state). To enable online play on GitHub Pages: create a Firebase project, enable Anonymous sign-in, create a Realtime Database, publish `database.rules.json`, and paste the web app config into `docs/firebase-config.js`.
