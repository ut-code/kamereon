import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 全体の CSS を先に読み、画面・部品の CSS（App から読まれる）を後にする。同じ強さの指定は後の方が勝つ
import './styles.css';
// 色・文字の基本の値
import './tokens.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
