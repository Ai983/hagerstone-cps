-- ============================================================================
-- Vendor Registration — checklist seed. Rules are DATA: change them with an
-- UPDATE, never a deploy.
--
-- premises_photo is mandatory for every type and NOT waivable (D8) — it may be
-- sourced third-party, but it must exist with a location.
-- photo_with_vendor is mandatory but IS waivable (D9); it is the only item
-- implying an actual site visit.
-- ============================================================================

INSERT INTO cps.cps_vendor_document_rules
  (vendor_type, document_type, is_mandatory, waivable, sort_order, active, notes)
VALUES
  -- Company / LLP / Partnership
  ('company','pan_card',          true,  false, 10, true, NULL),
  ('company','bank_proof',        true,  false, 20, true, 'Cancelled cheque or bank letter.'),
  ('company','gst_certificate',   true,  false, 30, true, NULL),
  ('company','itr_last_year',     true,  false, 40, true, NULL),
  ('company','itr_prior_year',    true,  false, 50, true, NULL),
  ('company','msme_udyam',        true,  false, 60, true, 'MSME certificate or Udyam registration.'),
  ('company','premises_photo',    true,  false, 70, true, 'Location required. On-site or third-party sourced (D8).'),
  ('company','photo_with_vendor', true,  true,  80, true, 'Waivable with a written reason (D9).'),
  ('company','other_proof',       false, false, 90, true, 'Optional, repeatable. Incorporation certificate goes here.'),

  -- Proprietor
  ('proprietor','pan_card',          true,  false, 10, true, NULL),
  ('proprietor','bank_proof',        true,  false, 20, true, 'Cancelled cheque or bank letter.'),
  ('proprietor','gst_certificate',   true,  false, 30, true, 'Mandatory unless marked not GST-registered with a written reason.'),
  ('proprietor','itr_last_year',     true,  false, 40, true, NULL),
  ('proprietor','itr_prior_year',    false, false, 50, true, 'Optional for proprietors.'),
  ('proprietor','msme_udyam',        true,  false, 60, true, NULL),
  ('proprietor','premises_photo',    true,  false, 70, true, 'Location required. On-site or third-party sourced (D8).'),
  ('proprietor','photo_with_vendor', true,  true,  80, true, 'Waivable with a written reason (D9).'),
  ('proprietor','other_proof',       false, false, 90, true, 'Optional, repeatable.'),

  -- Individual / labour contractor
  ('individual','pan_card',          true,  false, 10, true, NULL),
  ('individual','bank_proof',        true,  false, 20, true, 'Cancelled cheque or bank letter.'),
  ('individual','msme_udyam',        false, false, 30, true, 'Optional for individuals.'),
  ('individual','premises_photo',    true,  false, 40, true, 'Location required. On-site or third-party sourced (D8).'),
  ('individual','photo_with_vendor', true,  true,  50, true, 'Waivable with a written reason (D9).'),
  ('individual','other_proof',       false, false, 60, true, 'Optional, repeatable.')
ON CONFLICT (vendor_type, document_type) DO NOTHING;

COMMENT ON TABLE cps.cps_vendor_document_rules IS
  'Mandatory registration documents per vendor type. Rules are data - retune with UPDATE, not a deploy. '
  'premises_photo is never waivable (D8); photo_with_vendor is (D9).';
