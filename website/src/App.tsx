import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ScrollManager, SiteLayout } from './components/Layout';
import { LangProvider } from './lang';
import { Article, Blog } from './pages/Blog';
import { Signin, Signup } from './pages/Auth';
import { Home } from './pages/Home';

export function App() {
  return (
    <LangProvider>
      <BrowserRouter>
        <ScrollManager />
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<Home />} />
            <Route path="blog" element={<Blog />} />
            <Route path="blog/:id" element={<Article />} />
          </Route>
          <Route path="signup" element={<Signup />} />
          <Route path="signin" element={<Signin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </LangProvider>
  );
}
