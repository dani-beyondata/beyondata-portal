/* modals.css — modal overlay and dialog styles */

.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 200;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.modal-overlay.show { display: flex; }

.modal {
  background: var(--white);
  border-radius: var(--radius-lg);
  padding: 2rem;
  width: 100%;
  max-width: 440px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  animation: modal-in 0.15s ease;
}

@keyframes modal-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.modal h3 {
  font-size: 1.05rem;
  font-weight: 500;
  margin-bottom: 1.25rem;
  color: var(--text);
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.modal-actions .btn { flex: 1; justify-content: center; padding: 0.65rem; }

.modal-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.25rem 0;
}
