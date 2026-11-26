import { Routes } from '@angular/router';

// Una ruta por pantalla del inventario de replica/recon.md.
// S02 (acceso), S08 (exportar), S11 (pago) y S13 (aviso de plan) son modales, no rutas.
export const routes: Routes = [
  { path: '', title: 'Crea modelos 3D', loadComponent: () => import('./pages/home').then((m) => m.Home) },               // S01
  { path: 'crear', title: 'Crear', loadComponent: () => import('./features/workspace/workspace').then((m) => m.Workspace) }, // S03 S04 S05
  { path: 'mis-modelos', title: 'Mis modelos', loadComponent: () => import('./pages/my-models').then((m) => m.MyModels) }, // S06
  { path: 'modelo/:id', title: 'Modelo', loadComponent: () => import('./pages/placeholder').then((m) => m.Placeholder),   // S07
    data: { icon: 'box', title: 'Fichas públicas, próximamente', text: 'Pronto podrás compartir tus modelos públicos con un enlace.' } },
  { path: 'galeria', title: 'Galería', loadComponent: () => import('./pages/gallery').then((m) => m.Gallery) },            // S09
  // Tienda: precios de las figuras. Los planes de créditos (pages/pricing) quedan para BUSINESS_MODEL=credits
  { path: 'precios', title: 'Precios', loadComponent: () => import('./pages/shop-prices').then((m) => m.ShopPrices) },
  { path: 'planes', title: 'Planes', loadComponent: () => import('./pages/pricing').then((m) => m.Pricing) },             // S10 S11
  { path: 'pedidos', title: 'Mis pedidos', loadComponent: () => import('./pages/orders').then((m) => m.Orders) },
  { path: 'pedidos/:id', title: 'Pedido', loadComponent: () => import('./pages/orders').then((m) => m.OrderDetail) },
  { path: 'taller', title: 'Taller', loadComponent: () => import('./pages/workshop').then((m) => m.Workshop) },
  { path: 'cuenta', title: 'Tu cuenta', loadComponent: () => import('./pages/account').then((m) => m.Account) },           // S12
  { path: 'entrar', title: 'Entrando', loadComponent: () => import('./pages/sign-in-link').then((m) => m.SignInLink) },
  { path: 'privacidad', title: 'Privacidad', data: { doc: 'privacy' }, loadComponent: () => import('./pages/legal').then((m) => m.Legal) },
  { path: 'terminos', title: 'Términos', data: { doc: 'terms' }, loadComponent: () => import('./pages/legal').then((m) => m.Legal) },
  { path: '**', title: 'No encontrado', loadComponent: () => import('./pages/placeholder').then((m) => m.Placeholder),
    data: { icon: 'map-pin-off', title: 'Esta página no existe', text: 'Puede que el enlace esté mal o que el modelo se haya borrado.' } },
];
