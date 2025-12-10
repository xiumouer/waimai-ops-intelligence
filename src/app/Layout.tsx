import React from 'react'
import { NavLink, Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div className="container">
      <div className="header">
        <h2>外卖运营数智平台</h2>
        <div className="tabs">
          <NavLink to="/" end className={({isActive})=>`tab ${isActive?'active':''}`}>概览</NavLink>
          <NavLink to="/orders" className={({isActive})=>`tab ${isActive?'active':''}`}>订单分析</NavLink>
          <NavLink to="/geo" className={({isActive})=>`tab ${isActive?'active':''}`}>地理分布</NavLink>
          <NavLink to="/riders" className={({isActive})=>`tab ${isActive?'active':''}`}>骑手排名</NavLink>
          <NavLink to="/risk" className={({isActive})=>`tab ${isActive?'active':''}`}>风险监控</NavLink>
          <NavLink to="/income" className={({isActive})=>`tab ${isActive?'active':''}`}>收入结算</NavLink>
          <NavLink to="/dispatch" className={({isActive})=>`tab ${isActive?'active':''}`}>智能派单</NavLink>
        </div>
      </div>
      <div>
        <Outlet />
      </div>
    </div>
  )
}

