import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { Page } from './components/ui'
import Home from './pages/Home'
import NewCheck from './pages/NewCheck'
import Verify from './pages/Verify'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewCheck />} />
        <Route path="/v/:token" element={<Verify />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}

function NotFound() {
  return (
    <Page>
      <div className="py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <Link to="/" className="mt-3 inline-block underline underline-offset-4">
          Go home
        </Link>
      </div>
    </Page>
  )
}
