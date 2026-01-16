# Soccer Dashboard (Next.js + Tailwind)

This project displays a dashboard for:
- Bundesliga
- Premier League
- Serie A  
- Liga MX  
- La Liga

Each row is a team. Columns are the latest 7 match dates in that league.
Cells show:
- CK = Corner Kicks (greener when higher)
- G = Goals (red <= 2, green >= 3)
- C = Cards (red <= 4, green >= 5)

## Deploy to Vercel (recommended)
1) Upload this folder to GitHub
2) Import into Vercel
3) In Vercel: Settings -> Environment Variables
   Add:
   - APISPORTS_KEY = your API-Football key
4) Deploy

## Run locally
1) Create a file named `.env.local` in the project root:
   APISPORTS_KEY=your_key_here
2) Install & run:
   npm install
   npm run dev
