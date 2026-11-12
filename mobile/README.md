# Tula for Android

Expo (SDK 58) app: share a notice to Tula, confirm the deadline, get reminders sized to the stakes.

## What's built

| Piece | Where | Works without an account? |
| --- | --- | --- |
| Share → Tula for text, screenshots and PDFs | `src/app/+native-intent.ts`, `src/app/capture.tsx` | Text yes. Screenshots and PDFs need sign-in (AI reading) |
| Confirm card: every field editable, date words shown, repeats and moved dates flagged | `src/ui/DraftEditor.tsx` | Yes |
| One record per deadline: repeats merged, extensions kept in history | `src/engine/record.ts`, `src/engine/save.ts` | Yes |
| Dates decided by plain code; the model only proposes | `src/engine/dates.ts`, `src/engine/extract.ts` | Yes |
| Today: 2 or 3 picks, optional "Time today?", 72-hour radar | `src/app/(tabs)/index.tsx`, `src/engine/plan.ts` | Yes |
| Stakes-based reminders that fire with the app closed | `src/lib/reminders.ts` | Yes (local notifications) |
| Email-code sign-in, backup across devices, capture metrics for the pilot | `src/lib/backend.ts`, `src/lib/store.tsx` | Needs Supabase |
| Delete my data (phone, and account if signed in) | `src/app/(tabs)/settings.tsx` | Yes |

Deadlines live on the phone (AsyncStorage). The account is optional.

## Run it

```bash
npm install
```

```bash
npm test
```

```bash
npm run web
```

The web preview is for checking screens only: share, reminders and the native date picker need a phone.

Share → Tula needs a development build, not Expo Go. With an Android phone connected over USB (developer mode on) and Android Studio installed:

```bash
npm run android
```

Without Android Studio, build in the cloud with EAS and install the APK:

```bash
npx eas-cli@latest build --profile development --platform android
```

## Turn on AI reading and backup

1. Create a Supabase project, then from the repo root link it and push the schema: `npx supabase init` (once), `npx supabase link`, `npx supabase db push`.
2. Set the function secrets and deploy (see [../supabase/README.md](../supabase/README.md)).
3. Copy `.env.example` to `.env.local` and fill in the project URL and anon key.
4. In Supabase Auth, set the email template to send the 6-digit `{{ .Token }}` (the app signs in with a code, not a link).

## Checks

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

## Known limits

- Reminders use Android's normal (inexact) alarms, so one can arrive a few minutes late; aggressive battery savers can delay it more. The You tab tells students how to set battery use to Unrestricted.
- iOS is switched off in the share-intent plugin; the MVP is Android only.
- `app.tula.deadlines` is a placeholder package name. Change it before the first Play Store upload; it can't change afterwards.
