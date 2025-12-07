# Quick Start - Free Hosting Deployment

## 🚀 Deploy in 3 Steps

### Step 1: Push to GitHub (if not already done)

```powershell
# Initialize git (if not already initialized)
git init
git add .
git commit -m "Initial commit - FNO Dashboard"

# Create a new repository on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/fno-dashboard.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy Backend to Render

1. Go to [render.com](https://render.com) and sign up/login
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `fno-dashboard-api`
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build --workspace=apps/api`
   - **Start Command**: `npm start --workspace=apps/api`
   - **Instance Type**: Free
5. Add Environment Variables:
   ```
   NODE_ENV=production
   JWT_SECRET=<click 'Generate' for random value>
   PORT=4000
   ```
6. Click **"Create Web Service"**
7. **Copy your API URL**: `https://fno-dashboard-api.onrender.com`

### Step 3: Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up/login
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository
4. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `apps/web`
   - **Build Command**: Leave default
   - **Install Command**: `npm install`
5. Add Environment Variable:
   ```
   VITE_API_BASE_URL=https://fno-dashboard-api.onrender.com
   ```
   (Use the URL from Step 2)
6. Click **"Deploy"**
7. **Copy your Frontend URL**: `https://your-project.vercel.app`

### Step 4: Update Backend CORS

1. Go back to Render dashboard
2. Navigate to your API service
3. Go to **Environment** tab
4. Add environment variable:
   ```
   CORS_ORIGIN=https://your-project.vercel.app
   ```
   (Use the URL from Step 3)
5. Save and wait for auto-redeploy

---

## ✅ Done! Your app is now live!

- **Frontend**: https://your-project.vercel.app
- **Backend API**: https://fno-dashboard-api.onrender.com

---

## 📝 Important Notes

### Free Tier Limitations

**Render (Backend)**:
- Spins down after 15 minutes of inactivity
- First request after idle takes ~30-60 seconds (cold start)
- 512 MB RAM
- No always-on (available in paid tier: $7/month)

**Vercel (Frontend)**:
- 100 GB bandwidth/month
- Unlimited projects
- Always fast (global CDN)

### Recommended: Keep Backend Alive

To avoid cold starts, you can:

1. **Use a free cron service** like [cron-job.org](https://cron-job.org):
   - Set up a job to ping your API every 10 minutes
   - URL: `https://fno-dashboard-api.onrender.com/health`

2. **Upgrade to Render Paid Tier** ($7/month):
   - Always-on instances
   - No cold starts
   - Better performance

---

## 🔧 Configuration Files

I've created these files for your deployment:

- ✅ `vercel.json` - Vercel configuration
- ✅ `render.yaml` - Render Blueprint (optional alternative)
- ✅ `netlify.toml` - Netlify configuration (if you prefer Netlify)
- ✅ `apps/web/.env.production` - Frontend production environment
- ✅ `apps/api/.env.production` - Backend production environment template
- ✅ `DEPLOYMENT_GUIDE.md` - Detailed deployment documentation

---

## 🐛 Troubleshooting

### "Cannot connect to API"
- Check VITE_API_BASE_URL in Vercel environment variables
- Verify API is running on Render
- Check browser console for CORS errors

### "CORS Error"
- Ensure CORS_ORIGIN in Render matches your Vercel URL exactly
- Include https:// protocol
- No trailing slash

### "Build Failed"
- Check build logs in Render/Vercel dashboard
- Ensure all dependencies are in package.json
- Test build locally first: `npm run build`

---

## 🎯 Next Steps

1. Test all functionality in production
2. Set up custom domain (optional)
3. Configure Dhan API credentials in Render
4. Monitor application logs
5. Set up error tracking (optional: Sentry)

---

## 📚 Need More Help?

See `DEPLOYMENT_GUIDE.md` for:
- Detailed step-by-step instructions with screenshots
- Alternative hosting options
- Security best practices
- Troubleshooting guide
- Performance optimization tips

---

## 🆘 Support

If you encounter issues:
1. Check deployment logs
2. Verify all environment variables
3. Test API endpoints with Postman/curl
4. Check browser console for errors

Happy deploying! 🚀
