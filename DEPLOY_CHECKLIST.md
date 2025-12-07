# Deploy Checklist

## ✅ Pre-Deployment

- [x] Dependencies installed (`npm install`)
- [x] API builds successfully (`npm run build --workspace=apps/api`)
- [x] Web builds successfully (`npm run build --workspace=apps/web`)
- [x] TypeScript compilation errors fixed
- [ ] Code pushed to GitHub repository

## 🚀 Deployment Steps

### 1. Push to GitHub

```powershell
git add .
git commit -m "Prepare for deployment"
git push origin main
```

### 2. Deploy Backend (Render)

1. Go to [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect GitHub repo
4. Settings:
   - Name: `fno-dashboard-api`
   - Runtime: Node
   - Build: `npm install && npm run build --workspace=apps/api`
   - Start: `npm start --workspace=apps/api`
   - Instance: Free
5. Environment Variables:
   ```
   NODE_ENV=production
   JWT_SECRET=(click Generate)
   PORT=4000
   ```
6. Copy API URL: `https://fno-dashboard-api.onrender.com`

### 3. Deploy Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New..." → "Project"
3. Import GitHub repo
4. Settings:
   - Framework: Vite
   - Root Directory: `apps/web`
   - Build Command: `npm run build`
   - Install Command: `npm install`
5. Environment Variable:
   ```
   VITE_API_BASE_URL=https://fno-dashboard-api.onrender.com
   ```
6. Deploy
7. Copy Frontend URL: `https://your-project.vercel.app`

### 4. Update Backend CORS

1. Go back to Render
2. Environment → Add:
   ```
   CORS_ORIGIN=https://your-project.vercel.app
   ```
3. Save (auto-redeploys)

## 🎉 Done!

Your app is now live at:
- Frontend: `https://your-project.vercel.app`
- Backend: `https://fno-dashboard-api.onrender.com`

## 📝 Post-Deployment

- [ ] Test login functionality
- [ ] Verify API connectivity
- [ ] Check WebSocket connections
- [ ] Test option chain loading
- [ ] Verify all indices work

## 🔧 Optional

- [ ] Set up custom domain
- [ ] Configure Dhan API credentials
- [ ] Set up Redis (if needed)
- [ ] Add monitoring/alerts
- [ ] Set up keep-alive ping for Render

## 📚 Documentation

See complete guides:
- `DEPLOY_QUICK_START.md` - Quick deployment guide
- `DEPLOYMENT_GUIDE.md` - Detailed deployment documentation
