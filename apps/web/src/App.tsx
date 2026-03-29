import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AdminDashboard from './pages/AdminDashboard';
import PaidPlanPage from './pages/PaidPlanPage';
import RangePage from './pages/RangePage';
import StockDashboardPage from './pages/StockDashboardPage';
import ScannerExitPage from './pages/ScannerExitPage';
import EngineDashboardPage from './pages/EngineDashboardPage';

function App() {
  const { isAuthenticated, user } = useAuthStore();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      
      <Route
        path="/dashboard"
        element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" replace />}
      />
      
      <Route
        path="/ranges"
        element={isAuthenticated ? <RangePage /> : <Navigate to="/login" replace />}
      />
      
      <Route
        path="/stocks"
        element={isAuthenticated ? <StockDashboardPage /> : <Navigate to="/login" replace />}
      />
      
      <Route
        path="/scanner-exit"
        element={isAuthenticated ? <ScannerExitPage /> : <Navigate to="/login" replace />}
      />
      
      <Route
        path="/engine"
        element={isAuthenticated ? <EngineDashboardPage /> : <Navigate to="/login" replace />}
      />
      
      <Route
        path="/admin"
        element={
          isAuthenticated && (user?.role === 'superadmin' || user?.role === 'admin') ? (
            <AdminDashboard />
          ) : (
            <Navigate to="/dashboard" replace />
          )
        }
      />
      
      <Route
        path="/paid-plan"
        element={isAuthenticated ? <PaidPlanPage /> : <Navigate to="/login" replace />}
      />
      
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
