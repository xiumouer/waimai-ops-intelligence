import React from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Layout from './Layout'
import Overview from '../pages/Overview'
import OrdersAnalysis from '../pages/OrdersAnalysis'
import Geography from '../pages/Geography'
import RiderRanking from '../pages/RiderRanking'
import Risk from '../pages/Risk'
import Income from '../pages/Income'
import Dispatch from '../pages/Dispatch'

const router = createBrowserRouter([
  { path: '/', element: <Layout />, children: [
    { index: true, element: <Overview /> },
    { path: 'orders', element: <OrdersAnalysis /> },
    { path: 'geo', element: <Geography /> },
    { path: 'riders', element: <RiderRanking /> },
    { path: 'risk', element: <Risk /> },
    { path: 'income', element: <Income /> },
    { path: 'dispatch', element: <Dispatch /> },
  ]}
])

export function AppRouterProvider() {
  return <RouterProvider router={router} />
}

