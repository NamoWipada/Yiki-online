# ติดตั้ง Yiki Analytics บน Cloudflare Workers

ระบบนี้ใช้ Worker ตัวเดียวสำหรับเว็บไซต์ Static, LINE Webhook และ API โดยเก็บผลใน D1

## สิ่งที่ต้องมี

- บัญชี Cloudflare
- Node.js 20 ขึ้นไป
- LINE Official Account ที่เปิด Messaging API แล้ว
- ห้ามบันทึก Channel secret ลง Git หรือใส่ไว้ในไฟล์หน้าเว็บ

## 1. ติดตั้งและเข้าสู่ระบบ

```bash
npm install
npx wrangler login
```

คำสั่งที่สองจะเปิดหน้า Cloudflare ให้กดอนุญาต Wrangler

## 2. สร้างฐานข้อมูล

```bash
npx wrangler d1 create yiki-results
```

นำ `database_id` ที่ได้ไปแทน `REPLACE_WITH_D1_DATABASE_ID` ใน `wrangler.jsonc` แล้วสร้างตาราง:

```bash
npm run db:migrate:remote
```

## 3. ใส่ความลับของ LINE

คัดลอก Channel secret จาก LINE Developers > Provider > Messaging API channel > Basic settings แล้วรัน:

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
```

วางค่าในช่องรับข้อมูลของ Terminal เท่านั้น ไม่ต้องส่งค่าให้บุคคลอื่น

## 4. ทดสอบในเครื่อง

คัดลอก `.dev.vars.example` เป็น `.dev.vars` และใส่ Channel secret สำหรับทดสอบ จากนั้น:

```bash
npm run db:migrate:local
npm run dev
```

## 5. Deploy

```bash
npm run deploy
```

จะได้ URL ลักษณะ `https://yiki-online.<ชื่อบัญชี>.workers.dev`

## 6. เชื่อม LINE

1. เข้า LINE Developers และเลือก Messaging API channel
2. ที่ Messaging API > Webhook URL ใส่
   `https://yiki-online.<ชื่อบัญชี>.workers.dev/api/line/webhook`
3. กด Verify แล้วเปิด Use webhook
4. เชิญ Official Account เข้า LINE Group ที่ส่งผล
5. เปิด Allow bot to join group chats ใน Messaging API settings
6. ส่งข้อความรูปแบบ `รอบ 12 506 58` หรือ `506 58`
7. ตรวจผลที่ `/api/results?limit=264`

Webhook ตรวจ `x-line-signature` ทุกครั้งก่อนรับข้อมูล และใช้ `webhookEventId` ป้องกันผลซ้ำ
