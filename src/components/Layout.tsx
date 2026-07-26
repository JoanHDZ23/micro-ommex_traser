import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Camera, ClipboardList, Home, Plus } from 'lucide-react'

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()

  const navItems = [
    { path: '/', icon: Home, label: 'Inicio' },
    { path: '/new', icon: Plus, label: 'Nueva' },
    { path: '/history', icon: ClipboardList, label: 'Historial' },
  ]

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header */}
      <header className="bg-[var(--color-primary)] text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <Camera className="w-6 h-6 text-amber-400" />
        <div>
          <h1 className="text-lg font-bold leading-tight">Ommex Tracer</h1>
          <p className="text-xs text-blue-200">Registro Fotográfico</p>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom navigation (mobile-first) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around items-center py-2 z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
                isActive
                  ? 'text-[var(--color-primary)] font-semibold'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px]">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
