# TripNest — Design Prompt (רפרנס מחייב)

> הפרומפט המקורי שנוצר עם Gemini/Stitch. כל שינוי עיצובי באפליקציה חייב להישאר נאמן לשפה הזו.

Act as an elite UI/UX Designer and Expert Senior Frontend Developer. We are building the frontend shell for "TripNest" (המזוודה) - a premium family travel management PWA.

## 1. Design System & Vibe (CRITICAL)
- **Aesthetic:** Apple iOS / Airbnb / Modern Native App. It must look highly polished, minimalist, and expensive. NO bootstrap-like heavy colors.
- **Direction:** RTL (`<html dir="rtl" lang="he">`).
- **Typography:** Import 'Rubik' from Google Fonts.
- **Backgrounds:** The main app background must be a very soft off-white (`bg-slate-50`).
- **Cards:** Pure white (`bg-white`) with very soft, diffused modern shadows (`shadow-sm`, `shadow-[0_8px_30px_rgb(0,0,0,0.04)]`) and smooth rounding (`rounded-3xl` or `rounded-2xl`).
- **Colors:** Primary brand color is premium indigo (`text-indigo-600`, `bg-indigo-600`). Alerts should be soft (e.g., `bg-red-50 text-red-600` - NOT harsh red borders).
- **Glassmorphism:** Use `bg-white/70 backdrop-blur-lg` for sticky headers and the bottom nav.

## 2. View 1 — Home Screen
- **Header:** Sticky top, glassmorphism. App name "המזוודה 🧳" in bold, subtitle "TripNest". Notification bell icon (soft gray container).
- **Family Strip:** Horizontal scroll (hidden scrollbar). User avatars — clean circular images with a very subtle `ring-1 ring-slate-200`. Names below in small gray text. A "+" dashed circle button.
- **Hero Card (Upcoming Trip):** Massive card (`min-h-[280px] rounded-[2rem] overflow-hidden relative shadow-lg`). Background: full cover destination image. Gradient ONLY at the bottom (`bg-gradient-to-t from-black/90 via-black/40 to-transparent`). White title + dates. Glass pill top corner: "בעוד X ימים" (`bg-white/20 backdrop-blur-md text-white`). Entire card clickable.
- **Quick Actions:** Clean grid of 4 cards, icons on `bg-indigo-50 text-indigo-600 rounded-full p-3`: "סרוק מסמך", "כספת דרכונים", "רשימת אריזה", "תקציב".
- **Important Alerts:** Softly styled card, e.g. `bg-red-50 text-red-700 p-3 rounded-xl flex items-center gap-3`.

## 3. View 2 — Trip Dashboard
- **Header:** Sticky glassmorphism. Back arrow, trip title, settings icon.
- **Tabs:** Modern tabs — active tab gets bold indigo bottom border and text.
- **Documents Grid:** Category cards "טיסות ✈️", "לינה 🏨", "רכב 🚗", "ביטוח 🛡️" — pure white, rounded-2xl, soft shadow.
- **FAB:** Fixed bottom corner, large indigo circle, crisp white "+", `shadow-lg`, `active:scale-95`.

## 4. Fixed Bottom Navigation
- Glassmorphism (`bg-white/80 backdrop-blur-xl border-t border-slate-100`), `pb-safe`.
- Items: "בית", "טיולים", "סוכן AI", "הגדרות".
- **AI Button:** Prominent gradient circle (`bg-gradient-to-tr from-indigo-600 to-purple-500 text-white rounded-full -mt-4 shadow-md`).
