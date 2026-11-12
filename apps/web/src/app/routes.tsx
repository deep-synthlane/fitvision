import type { RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { OnboardingPage } from '../features/onboarding/OnboardingPage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { ScanPage } from '../features/scan/ScanPage';
import { AvatarPage } from '../features/avatar/AvatarPage';
import { AddClothingPage } from '../features/clothing/AddClothingPage';
import { ProductDetailPage } from '../features/clothing/ProductDetailPage';
import { TryOnResultPage } from '../features/tryon/TryOnResultPage';
import { TryOnStartPage } from '../features/tryon/TryOnStartPage';
import { TryOnsPage } from '../features/tryon/TryOnsPage';
import { WardrobePage } from '../features/wardrobe/WardrobePage';
import { AccountDeletedPage } from '../features/account/AccountDeletedPage';
import { PrivacyPage } from '../features/account/PrivacyPage';
import { Navigate } from 'react-router';
import { AppLayout } from './AppLayout';
import { RequireAuth, RequireGuest } from './guards';
import { NotFoundPage } from './NotFoundPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <RequireGuest><LoginPage /></RequireGuest> },
  { path: '/register', element: <RequireGuest><RegisterPage /></RequireGuest> },
  { path: '/goodbye', element: <AccountDeletedPage /> },
  { path: '/onboarding', element: <RequireAuth><OnboardingPage /></RequireAuth> },
  {
    element: <RequireAuth onboarded><AppLayout /></RequireAuth>,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'scan', element: <ScanPage /> },
      { path: 'avatar', element: <AvatarPage /> },
      { path: 'wardrobe', element: <WardrobePage /> },
      { path: 'clothing', element: <Navigate to="/wardrobe" replace /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'clothing/new', element: <AddClothingPage /> },
      { path: 'clothing/:id', element: <ProductDetailPage /> },
      { path: 'clothing/:id/try-on', element: <TryOnStartPage /> },
      { path: 'try-ons', element: <TryOnsPage /> },
      { path: 'try-ons/:id', element: <TryOnResultPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
