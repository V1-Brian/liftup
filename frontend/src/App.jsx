import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import Dashboard    from './pages/Dashboard'
import InvoicePage  from './pages/InvoicePage'
import HistoryPage  from './pages/HistoryPage'
import SkuPage      from './pages/SkuPage'

function Sidebar() {
  const loc = useLocation()
  const nav = useNavigate()

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-title">Liftup</div>
        <div className="sidebar-logo-sub">Invoice Tracker</div>
      </div>

      <div className="nav-section">Invoicing</div>
      <NavLink to="/" end className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
        📊 Dashboard
      </NavLink>
      <NavLink to="/invoice/new" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
        ➕ New invoice
      </NavLink>
      <NavLink to="/history" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
        🗂 Invoice history
      </NavLink>

      <div className="nav-section">Settings</div>
      <NavLink to="/skus" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
        ⚙️ SKU config
      </NavLink>
    </div>
  )
}

export default function App() {
  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <Routes>
          <Route path="/"               element={<Dashboard />} />
          <Route path="/invoice/new"    element={<InvoicePage />} />
          <Route path="/invoice/:month" element={<InvoicePage />} />
          <Route path="/history"        element={<HistoryPage />} />
          <Route path="/skus"           element={<SkuPage />} />
        </Routes>
      </div>
    </div>
  )
}
