# Cloudflare Deploy

Acest proiect poate rula pe Cloudflare Workers + D1, fără sleep după inactivitate.

## 1. Instalează dependențele root

```bash
npm install
```

## 2. Autentificare Cloudflare

```bash
npx wrangler login
```

## 3. Creează baza D1

```bash
npm run d1:create
```

Comanda va afișa un `database_id`. Copiază acel id în `wrangler.toml`, în loc de:

```toml
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```

## 4. Aplică schema bazei de date

```bash
npm run d1:migrate:remote
```

## 5. Mută datele din SQLite local în D1

Generează exportul local:

```bash
npm run d1:export
```

Aplică exportul în Cloudflare:

```bash
npx wrangler d1 execute small-wedding-db --remote --file d1/seed.sql
```

`d1/seed.sql` este ignorat de git pentru că poate conține numele invitaților și cheile invitațiilor.

## 6. Adaugă secretele în Cloudflare

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put RSVP_EMAIL_TO
npx wrangler secret put WEB3FORMS_ACCESS_KEY_CLOUDFLARE
```

Valori recomandate:

- `ADMIN_TOKEN`: același token admin pe care îl folosești acum
- `RSVP_EMAIL_TO`: `adrian.plapamaru@gmail.com`
- `WEB3FORMS_ACCESS_KEY_CLOUDFLARE`: cheia Web3Forms pentru domeniul Cloudflare/custom domain

## 7. Deploy

```bash
npm run deploy
```

La final vei primi un URL de forma:

```text
https://small-wedding.<contul-tau>.workers.dev
```

Adminul va fi:

```text
https://small-wedding.<contul-tau>.workers.dev/admin
```
