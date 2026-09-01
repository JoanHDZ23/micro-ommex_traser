import { Outlet } from 'react-router-dom'

export function Layout() {
  return (
    <div className="flex flex-col h-[100dvh]">
      <main className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
