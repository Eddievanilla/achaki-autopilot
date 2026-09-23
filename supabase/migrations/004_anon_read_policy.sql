-- ============================================================
-- ACHAki Autopilot — Migration 004: Anon Read Access for Dashboard (Fase 5.3)
-- ============================================================

-- Permite leitura pública (SELECT) de dados de catálogo e status operacional
CREATE POLICY "Allow public read on products"
    ON public.products FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow public read on product_prices"
    ON public.product_prices FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow public read on offer_candidates"
    ON public.offer_candidates FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow public read on system_state"
    ON public.system_state FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow public read on system_activity_logs"
    ON public.system_activity_logs FOR SELECT
    TO anon
    USING (true);
