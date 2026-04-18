# DSP Resource Sheet

A static React + Vite app for tracking Dyson Sphere Program resource extraction, transport planning, and project demand.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Deployment

This repo is set up for free deployment on GitHub Pages with GitHub Actions.

After pushing to GitHub:

1. Open the repository settings.
2. Go to `Settings -> Pages`.
3. Set the source to `GitHub Actions`.
4. Push to `main` or `master`, or run the `Deploy to GitHub Pages` workflow manually.

The built site is published from `dist`.

## Notes

- The app stores its working data in the browser, so no backend or database hosting is required.
- Snapshot import/export is included for backups and moving data between browsers.
