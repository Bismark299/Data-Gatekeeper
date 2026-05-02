--
-- PostgreSQL database dump
--

\restrict DGHkgIwKTrRfVytd8volmO5fDQB5nybGtIUvbZPUnvOYalPc2aor6cZOvGZhsjv

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bundles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bundles (
    id integer NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    data_amount text NOT NULL,
    validity_days integer NOT NULL,
    price numeric(10,2) NOT NULL,
    category text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    network text DEFAULT 'mtn'::text NOT NULL,
    dealer_price numeric(10,2),
    agent_price numeric(10,2)
);


ALTER TABLE public.bundles OWNER TO postgres;

--
-- Name: bundles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bundles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bundles_id_seq OWNER TO postgres;

--
-- Name: bundles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bundles_id_seq OWNED BY public.bundles.id;


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cart_items (
    id integer NOT NULL,
    user_id integer NOT NULL,
    bundle_id integer NOT NULL,
    phone_number text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.cart_items OWNER TO postgres;

--
-- Name: cart_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cart_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cart_items_id_seq OWNER TO postgres;

--
-- Name: cart_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cart_items_id_seq OWNED BY public.cart_items.id;


--
-- Name: deposits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.deposits (
    id integer NOT NULL,
    user_id integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    method text DEFAULT 'manual'::text NOT NULL,
    reference text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.deposits OWNER TO postgres;

--
-- Name: deposits_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.deposits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.deposits_id_seq OWNER TO postgres;

--
-- Name: deposits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.deposits_id_seq OWNED BY public.deposits.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    user_id integer NOT NULL,
    bundle_id integer NOT NULL,
    bundle_name text NOT NULL,
    bundle_data text NOT NULL,
    price numeric(10,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    phone_number text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.orders_id_seq OWNER TO postgres;

--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.sessions OWNER TO postgres;

--
-- Name: settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value text DEFAULT ''::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.settings OWNER TO postgres;

--
-- Name: store_bundles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_bundles (
    id integer NOT NULL,
    store_id integer NOT NULL,
    bundle_id integer NOT NULL,
    selling_price numeric(10,2) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.store_bundles OWNER TO postgres;

--
-- Name: store_bundles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.store_bundles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.store_bundles_id_seq OWNER TO postgres;

--
-- Name: store_bundles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.store_bundles_id_seq OWNED BY public.store_bundles.id;


--
-- Name: store_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_orders (
    id integer NOT NULL,
    store_id integer NOT NULL,
    store_bundle_id integer NOT NULL,
    bundle_id integer NOT NULL,
    bundle_name text NOT NULL,
    bundle_data text NOT NULL,
    bundle_network text NOT NULL,
    bundle_validity_days integer DEFAULT 0 NOT NULL,
    customer_phone text NOT NULL,
    customer_email text DEFAULT ''::text NOT NULL,
    selling_price numeric(10,2) NOT NULL,
    base_price numeric(10,2) NOT NULL,
    profit numeric(10,2) NOT NULL,
    paystack_reference text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_cost numeric(10,2)
);


ALTER TABLE public.store_orders OWNER TO postgres;

--
-- Name: store_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.store_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.store_orders_id_seq OWNER TO postgres;

--
-- Name: store_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.store_orders_id_seq OWNED BY public.store_orders.id;


--
-- Name: store_withdrawals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_withdrawals (
    id integer NOT NULL,
    store_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    method text DEFAULT 'mobile_money'::text NOT NULL,
    account_number text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_name text DEFAULT ''::text NOT NULL,
    bank_code text DEFAULT 'MTN'::text NOT NULL
);


ALTER TABLE public.store_withdrawals OWNER TO postgres;

--
-- Name: store_withdrawals_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.store_withdrawals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.store_withdrawals_id_seq OWNER TO postgres;

--
-- Name: store_withdrawals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.store_withdrawals_id_seq OWNED BY public.store_withdrawals.id;


--
-- Name: stores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stores (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    color_theme text DEFAULT 'blue'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    profit_balance numeric(12,2) DEFAULT 0.00 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    momo_network text,
    momo_number text,
    momo_name text
);


ALTER TABLE public.stores OWNER TO postgres;

--
-- Name: stores_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stores_id_seq OWNER TO postgres;

--
-- Name: stores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stores_id_seq OWNED BY public.stores.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    phone text,
    role text DEFAULT 'user'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deposit_code text,
    deleted_at timestamp with time zone
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: wallet_ledger; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wallet_ledger (
    id integer NOT NULL,
    user_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    type text NOT NULL,
    source text NOT NULL,
    reference text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.wallet_ledger OWNER TO postgres;

--
-- Name: wallet_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.wallet_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.wallet_ledger_id_seq OWNER TO postgres;

--
-- Name: wallet_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.wallet_ledger_id_seq OWNED BY public.wallet_ledger.id;


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wallets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    balance numeric(12,2) DEFAULT 0.00 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.wallets OWNER TO postgres;

--
-- Name: wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.wallets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.wallets_id_seq OWNER TO postgres;

--
-- Name: wallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.wallets_id_seq OWNED BY public.wallets.id;


--
-- Name: bundles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bundles ALTER COLUMN id SET DEFAULT nextval('public.bundles_id_seq'::regclass);


--
-- Name: cart_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart_items ALTER COLUMN id SET DEFAULT nextval('public.cart_items_id_seq'::regclass);


--
-- Name: deposits id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposits ALTER COLUMN id SET DEFAULT nextval('public.deposits_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: store_bundles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_bundles ALTER COLUMN id SET DEFAULT nextval('public.store_bundles_id_seq'::regclass);


--
-- Name: store_orders id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_orders ALTER COLUMN id SET DEFAULT nextval('public.store_orders_id_seq'::regclass);


--
-- Name: store_withdrawals id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_withdrawals ALTER COLUMN id SET DEFAULT nextval('public.store_withdrawals_id_seq'::regclass);


--
-- Name: stores id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stores ALTER COLUMN id SET DEFAULT nextval('public.stores_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: wallet_ledger id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_ledger ALTER COLUMN id SET DEFAULT nextval('public.wallet_ledger_id_seq'::regclass);


--
-- Name: wallets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallets ALTER COLUMN id SET DEFAULT nextval('public.wallets_id_seq'::regclass);


--
-- Data for Name: bundles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bundles (id, name, description, data_amount, validity_days, price, category, is_active, created_at, updated_at, network, dealer_price, agent_price) FROM stdin;
6	Telecel Weekly 7GB	Full week of high-speed Telecel data	7GB	7	10.00	weekly	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	telecel	\N	\N
7	Telecel Monthly 20GB	Generous monthly Telecel plan for heavy users	20GB	30	30.00	monthly	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	telecel	\N	\N
9	iShare Daily 1.5GB	Power your day with 1.5GB AirtelTigo data	1.5GB	1	2.50	daily	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	at-ishare	\N	\N
10	iShare Weekly 6GB	A week of reliable AirtelTigo browsing	6GB	7	9.00	weekly	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	at-ishare	\N	\N
11	iShare Monthly 18GB	Full month of AirtelTigo iShare data	18GB	30	28.00	monthly	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	at-ishare	\N	\N
13	Big-Time Starter 2GB	Kick off big with 2GB of AirtelTigo Big-Time data	2GB	2	3.00	daily	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	at-bigtime	\N	\N
14	Big-Time Weekly 10GB	Go big all week with 10GB AirtelTigo data	10GB	7	14.00	weekly	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	at-bigtime	\N	\N
15	Big-Time Unlimited	No limits, full speed — AirtelTigo unlimited monthly	Unlimited	30	45.00	monthly	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	at-bigtime	\N	\N
16	Big-Time Plus 30GB	30GB of premium AirtelTigo data for power users	30GB	30	38.00	monthly	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	at-bigtime	\N	\N
41	MTN 20GB	MTN 20GB Data Bundle	20GB	30	32.00	standard	t	2026-04-23 02:49:09.791266+00	2026-04-23 02:49:09.791266+00	mtn	\N	\N
42	MTN 30GB	MTN 30GB Data Bundle	30GB	30	48.00	standard	t	2026-04-23 02:49:09.795891+00	2026-04-23 02:49:09.795891+00	mtn	\N	\N
43	MTN 50GB	MTN 50GB Data Bundle	50GB	30	75.00	standard	t	2026-04-23 02:49:09.799961+00	2026-04-23 02:49:09.799961+00	mtn	\N	\N
3	MTN 15GB	MTN 15GB Data Bundle	15GB	30	25.00	standard	t	2026-04-22 20:08:57.199133+00	2026-04-26 01:27:58.001+00	mtn	\N	\N
12	AT iShare 2GB	Social media data — WhatsApp, Facebook, TikTok	2GB	7	3.50	weekly	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	at-ishare	\N	\N
8	Telecel 4GB	4GB of data active from midnight to 6AM	4GB	7	4.00	weekly	t	2026-04-22 20:08:57.199133+00	2026-04-22 20:08:57.199133+00	telecel	\N	\N
5	Telecel 5GB	Telecel 5GB Data Bundle	5GB	30	25.00	standard	t	2026-04-22 20:08:57.199133+00	2026-04-26 01:48:46.32+00	telecel	\N	\N
40	MTN 25GB	MTN 25GB Data Bundle	25GB	30	20.00	standard	t	2026-04-23 02:49:09.787846+00	2026-04-28 22:38:50.323+00	mtn	\N	\N
34	MTN 40GB	MTN 40GB Data Bundle	40GB	30	1.00	standard	t	2026-04-23 02:49:09.72548+00	2026-04-28 22:39:06.963+00	mtn	\N	\N
1	MTN 1GB	MTN 1GB Data Bundle	1GB	30	3.80	standard	t	2026-04-22 20:08:57.199133+00	2026-04-29 02:17:58.643+00	mtn	4.20	4.30
35	MTN 2GB	MTN 2GB Data Bundle	2GB	30	7.40	standard	t	2026-04-23 02:49:09.766022+00	2026-04-29 02:18:36.236+00	mtn	8.30	8.40
4	MTN 3GB	MTN 3GB Data Bundle	3GB	30	11.40	standard	t	2026-04-22 20:08:57.199133+00	2026-04-29 02:19:06.248+00	mtn	12.30	12.40
36	MTN 4GB 	MTN 4GB  Data Bundle	4GB 	30	15.20	standard	t	2026-04-23 02:49:09.770348+00	2026-04-29 02:19:51.804+00	mtn	16.30	16.40
2	MTN 5GB	MTN 5GB Data Bundle	5GB	30	19.00	standard	t	2026-04-22 20:08:57.199133+00	2026-04-29 02:20:25.126+00	mtn	20.40	20.50
37	MTN 6GB	MTN 6GB Data Bundle	6GB	30	24.00	standard	t	2026-04-23 02:49:09.77432+00	2026-04-29 03:30:12.259+00	mtn	25.00	26.00
38	MTN 8GB	MTN 8GB Data Bundle	8GB	30	32.00	standard	t	2026-04-23 02:49:09.778523+00	2026-04-29 03:30:26.895+00	mtn	33.00	34.00
39	MTN 10GB	MTN 10GB Data Bundle	10GB	30	37.50	standard	t	2026-04-23 02:49:09.782361+00	2026-04-29 03:30:48.282+00	mtn	40.00	41.00
\.


--
-- Data for Name: cart_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cart_items (id, user_id, bundle_id, phone_number, created_at) FROM stdin;
\.


--
-- Data for Name: deposits; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.deposits (id, user_id, amount, status, method, reference, note, created_at, updated_at) FROM stdin;
1	2	50.00	completed	mobile_money	DEP-001	Initial deposit	2026-04-22 20:08:57.213257+00	2026-04-22 20:08:57.213257+00
2	3	30.00	completed	mobile_money	DEP-002	Initial deposit	2026-04-22 20:08:57.213257+00	2026-04-22 20:08:57.213257+00
34	34	5.00	completed	mobile_money	\N	\N	2026-04-22 21:31:48.138388+00	2026-04-22 21:31:48.138388+00
35	2	50.00	completed	momo	TEST-12345-ABCDE	Approved by admin	2026-04-22 23:24:00.037785+00	2026-04-22 23:24:46.489+00
36	34	5.00	completed	paystack	DB-PS-34-1776900352113	Paystack payment verified	2026-04-22 23:25:52.762403+00	2026-04-22 23:26:47.252+00
38	34	50.00	completed	paystack	DB-PS-34-1776902185680	Paystack payment verified	2026-04-22 23:56:26.230122+00	2026-04-22 23:57:07.385+00
39	34	200.00	completed	paystack	DB-PS-34-1776902431671	Paystack payment verified	2026-04-23 00:00:32.044219+00	2026-04-23 00:01:07.714+00
37	2	50.00	completed	paystack	DB-PS-2-1776901419605	Approved by admin	2026-04-22 23:43:40.127117+00	2026-04-23 00:08:51.184+00
40	34	100.00	completed	paystack	DB-PS-34-1776938528714	Paystack payment verified	2026-04-23 10:02:09.279628+00	2026-04-23 10:02:31.898+00
41	34	200.00	completed	paystack	DB-PS-34-1776939727894	Paystack payment verified	2026-04-23 10:22:08.316766+00	2026-04-23 10:22:29.569+00
42	34	10.00	completed	paystack	DB-PS-34-1777418050798	Paystack payment verified	2026-04-28 23:14:11.195279+00	2026-04-28 23:14:41.923+00
43	34	200.00	completed	paystack	DB-PS-34-1777461455657	Paystack payment verified	2026-04-29 11:17:36.189554+00	2026-04-29 11:18:03.856+00
44	34	-100.00	completed	admin	admin-debit-1-1777507244229	Admin debit (by admin #1)	2026-04-30 00:00:44.229741+00	2026-04-30 00:00:44.229741+00
45	2	-140.00	completed	admin	admin-debit-1-1777507258710	Admin debit (by admin #1)	2026-04-30 00:00:58.710722+00	2026-04-30 00:00:58.710722+00
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.orders (id, user_id, bundle_id, bundle_name, bundle_data, price, status, phone_number, created_at, updated_at) FROM stdin;
1	2	2	MTN Weekly 5GB	5GB	8.00	completed	+233244123456	2026-04-22 20:08:57.218687+00	2026-04-22 20:08:57.218687+00
2	2	7	Telecel Monthly 20GB	20GB	30.00	completed	+233244123456	2026-04-22 20:08:57.218687+00	2026-04-22 20:08:57.218687+00
4	3	11	iShare Monthly 18GB	18GB	28.00	completed	+233207654321	2026-04-22 20:08:57.218687+00	2026-04-22 20:08:57.218687+00
34	34	1	MTN Daily 1GB	1GB	2.00	completed	0555546229	2026-04-22 21:36:27.21254+00	2026-04-23 02:05:13.375+00
5	3	14	Big-Time Weekly 10GB	10GB	14.00	completed	+233207654321	2026-04-22 20:08:57.218687+00	2026-04-26 01:33:58.89+00
3	2	1	MTN Daily 1GB	1GB	2.00	completed	+233244123456	2026-04-22 20:08:57.218687+00	2026-04-26 01:33:58.89+00
40	34	34	MTN 500MB	500MB	1.00	completed	0247879363	2026-04-23 10:21:11.951315+00	2026-04-26 01:33:58.89+00
39	34	1	MTN Daily 1GB	1GB	2.00	completed	0659745238	2026-04-23 10:01:14.519899+00	2026-04-26 01:33:58.89+00
38	34	34	MTN 500MB	500MB	1.00	completed	0555546229	2026-04-23 09:48:30.462363+00	2026-04-26 01:33:58.89+00
37	2	4	MTN XtraTime 3GB	3GB	5.00	completed	0244123456	2026-04-23 02:22:19.894045+00	2026-04-26 01:33:58.89+00
36	2	4	MTN XtraTime 3GB	3GB	5.00	completed	0244123456	2026-04-23 02:20:03.57992+00	2026-04-26 01:33:58.89+00
35	34	4	MTN XtraTime 3GB	3GB	5.00	completed	0555546229	2026-04-23 02:19:25.627258+00	2026-04-26 01:33:58.89+00
41	34	43	MTN 50GB	50GB	75.00	completed	0548065692	2026-04-26 02:01:45.449555+00	2026-04-26 02:15:31.457+00
42	34	1	MTN Daily 1GB	1GB	2.00	completed	0555546229	2026-04-28 01:09:08.468192+00	2026-04-28 22:27:41.661+00
43	34	8	Telecel 4GB	4GB	4.00	completed	0502145326	2026-04-28 01:09:08.476658+00	2026-04-28 22:27:43.953+00
44	34	2	MTN Weekly 5GB	5GB	10.00	completed	0548065692	2026-04-28 22:34:56.546362+00	2026-04-29 01:23:28.614+00
45	34	1	MTN 1GB	1GB	3.80	completed	0247879363	2026-04-29 23:19:07.637035+00	2026-04-29 23:21:13.783+00
46	34	4	MTN 3GB	3GB	11.40	completed	0555546229	2026-04-29 23:19:07.637035+00	2026-04-29 23:21:19.34+00
48	34	1	MTN 1GB	1GB	3.80	completed	0555546229	2026-05-02 00:15:39.27641+00	2026-05-02 00:21:08.527+00
47	34	43	MTN 50GB	50GB	75.00	completed	0247879363	2026-05-02 00:15:39.27641+00	2026-05-02 00:21:18.883+00
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sessions (sid, sess, expire) FROM stdin;
iAaf3To-NDjOQiuDNt9MWWKQ0Q0ytLyD	{"cookie":{"originalMaxAge":604800000,"expires":"2026-05-09T01:10:42.489Z","secure":true,"httpOnly":true,"path":"/","sameSite":"none"},"userId":1,"userRole":"admin"}	2026-05-09 12:27:45
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.settings (key, value, updated_at) FROM stdin;
\.


--
-- Data for Name: store_bundles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.store_bundles (id, store_id, bundle_id, selling_price, is_active, created_at, updated_at) FROM stdin;
1	1	2	10.00	t	2026-04-23 02:40:02.97759+00	2026-04-23 02:40:02.97759+00
2	2	2	10.00	t	2026-04-23 02:43:39.800085+00	2026-04-23 02:43:39.800085+00
3	2	1	15.00	t	2026-04-26 02:17:22.998361+00	2026-04-26 02:29:06.802+00
5	2	5	30.00	t	2026-04-28 00:43:24.889687+00	2026-04-28 00:43:24.889687+00
4	2	8	15.00	t	2026-04-28 00:41:03.927454+00	2026-04-29 17:25:20.889+00
\.


--
-- Data for Name: store_orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.store_orders (id, store_id, store_bundle_id, bundle_id, bundle_name, bundle_data, bundle_network, bundle_validity_days, customer_phone, customer_email, selling_price, base_price, profit, paystack_reference, status, created_at, updated_at, agent_cost) FROM stdin;
1	2	2	2	MTN Weekly 5GB	5GB	mtn	7	0555546229	markbis17@gmail.com	10.00	8.00	2.00	STORE-2-1776913234934	completed	2026-04-23 03:00:34.934906+00	2026-04-23 03:00:59.18+00	\N
2	2	3	1	MTN Daily 1GB	1GB	mtn	1	0555546229	markbis17@gmail.com	15.00	2.00	13.00	STORE-2-1777170618539	completed	2026-04-26 02:30:18.540156+00	2026-04-26 02:30:43.906+00	\N
3	2	2	2	MTN Weekly 5GB	5GB	mtn	7	0555546229	markbis17@gmail.com	10.00	10.00	0.00	STORE-2-1777336462292	completed	2026-04-28 00:34:22.293376+00	2026-04-28 22:45:25.903+00	\N
4	2	4	8	Telecel 4GB	4GB	telecel	7	0501423689	markbis17@gmail.com	6.00	4.00	2.00	STORE-2-1777416636293	completed	2026-04-28 22:50:36.294265+00	2026-04-29 00:00:20.371+00	\N
5	2	3	1	MTN 1GB	1GB	mtn	30	0548065692	otengbismark7@gmail.com	15.00	3.80	11.20	STORE-2-1777681002295	completed	2026-05-02 00:16:42.296376+00	2026-05-02 00:22:46.939+00	\N
\.


--
-- Data for Name: store_withdrawals; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.store_withdrawals (id, store_id, amount, status, method, account_number, note, created_at, updated_at, account_name, bank_code) FROM stdin;
2	2	3.00	completed	mobile_money	0247879363	[TRF_2ndbol1h9fyw9v4o]	2026-04-28 01:19:02.514647+00	2026-04-28 01:19:03.58+00		MTN
3	2	4.00	completed	mobile_money	0555546229	[TRF_uzzm0gijrl45nq1f]	2026-04-29 01:00:13.506935+00	2026-04-29 01:00:15.662+00	BISMARK KWAME OTENG	MTN
1	2	10.00	completed	mobile_money	0555546229	[TRF_enisfd6hem412y7o]	2026-04-28 00:48:07.081289+00	2026-04-29 01:19:39.17+00		MTN
\.


--
-- Data for Name: stores; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stores (id, user_id, name, slug, description, color_theme, is_active, profit_balance, created_at, updated_at, momo_network, momo_number, momo_name) FROM stdin;
1	2	Kwame Data Hub	kwame-data-hub		yellow	t	0.00	2026-04-23 02:37:34.646819+00	2026-04-23 02:37:34.646819+00	\N	\N	\N
2	34	kem+	kem	we will make life easier for you	blue	t	11.20	2026-04-23 02:39:48.088373+00	2026-05-02 00:22:46.939+00	MTN	0555546229	BISMARK KWAME OTENG
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, name, email, password_hash, phone, role, is_active, created_at, updated_at, deposit_code, deleted_at) FROM stdin;
1	System Admin	admin@databundle.com	$2b$12$GgJWpGpQZLRlFIuLByxecumlmCusaVuPYHssmVkSw58AmDiUZGouS	+233244000000	admin	t	2026-04-22 20:08:57.17615+00	2026-04-22 20:08:57.17615+00	BT-Y4ULTW	\N
3	Akosua Asante	akosua@example.com	$2b$12$vbemMM/rwSDV6WTI0ByDVu3P2ayd38mMwBgEcDyFrYwEb/kwT2Cem	+233207654321	agent	t	2026-04-22 20:08:57.191025+00	2026-04-29 03:12:37.95+00	BT-2JCCCG	\N
2	Kwame Mensah	kwame@example.com	$2b$12$vbemMM/rwSDV6WTI0ByDVu3P2ayd38mMwBgEcDyFrYwEb/kwT2Cem	+233244123456	agent	t	2026-04-22 20:08:57.185156+00	2026-04-29 03:12:42.274+00	BT-8ZFNUP	\N
34	Kris	markbis17@gmail.com	$2b$12$kRhvUeMmmH/iG.DeBO6U7.5LusrGkioj7LkeYC2ceQbt7q8FprONa	+233548065692	dealer	t	2026-04-22 21:25:13.56021+00	2026-04-29 16:36:51.178+00	BT-JVLSHC	\N
\.


--
-- Data for Name: wallet_ledger; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.wallet_ledger (id, user_id, amount, type, source, reference, note, created_at) FROM stdin;
1	34	200.00	credit	paystack	DB-PS-34-1777461455657	Paystack deposit of GH₵200.00	2026-04-29 11:18:03.855764+00
2	34	-3.80	debit	cart	order-45	MTN 1GB → 0247879363	2026-04-29 23:19:07.637035+00
3	34	-11.40	debit	cart	order-46	MTN 3GB → 0555546229	2026-04-29 23:19:07.637035+00
4	34	-100.00	debit	admin	admin-debit-1-1777507244229	Admin debit: Admin debit (admin #1)	2026-04-30 00:00:44.229741+00
5	2	-140.00	debit	admin	admin-debit-1-1777507258710	Admin debit: Admin debit (admin #1)	2026-04-30 00:00:58.710722+00
6	34	-75.00	debit	cart	order-47	MTN 50GB → 0247879363	2026-05-02 00:15:39.27641+00
7	34	-3.80	debit	cart	order-48	MTN 1GB → 0555546229	2026-05-02 00:15:39.27641+00
\.


--
-- Data for Name: wallets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.wallets (id, user_id, balance, updated_at) FROM stdin;
2	3	30.00	2026-04-22 20:08:57.206263+00
34	1	0.00	2026-04-22 21:19:51.733011+00
1	2	0.00	2026-04-30 00:00:58.711+00
35	34	474.00	2026-05-02 00:15:39.277+00
\.


--
-- Name: bundles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bundles_id_seq', 43, true);


--
-- Name: cart_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cart_items_id_seq', 15, true);


--
-- Name: deposits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.deposits_id_seq', 45, true);


--
-- Name: orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.orders_id_seq', 48, true);


--
-- Name: store_bundles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.store_bundles_id_seq', 5, true);


--
-- Name: store_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.store_orders_id_seq', 5, true);


--
-- Name: store_withdrawals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.store_withdrawals_id_seq', 3, true);


--
-- Name: stores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stores_id_seq', 2, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 34, true);


--
-- Name: wallet_ledger_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.wallet_ledger_id_seq', 7, true);


--
-- Name: wallets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.wallets_id_seq', 36, true);


--
-- Name: bundles bundles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bundles
    ADD CONSTRAINT bundles_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);


--
-- Name: deposits deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_pkey PRIMARY KEY (id);


--
-- Name: deposits deposits_reference_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_reference_unique UNIQUE (reference);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: sessions session_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: store_bundles store_bundles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_bundles
    ADD CONSTRAINT store_bundles_pkey PRIMARY KEY (id);


--
-- Name: store_orders store_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_orders
    ADD CONSTRAINT store_orders_pkey PRIMARY KEY (id);


--
-- Name: store_withdrawals store_withdrawals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_withdrawals
    ADD CONSTRAINT store_withdrawals_pkey PRIMARY KEY (id);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: stores stores_slug_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_slug_unique UNIQUE (slug);


--
-- Name: stores stores_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_user_id_unique UNIQUE (user_id);


--
-- Name: users users_deposit_code_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_deposit_code_unique UNIQUE (deposit_code);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wallet_ledger wallet_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_unique UNIQUE (user_id);


--
-- Name: idx_session_expire; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_session_expire ON public.sessions USING btree (expire);


--
-- Name: cart_items cart_items_bundle_id_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_bundle_id_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.bundles(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: deposits deposits_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: orders orders_bundle_id_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_bundle_id_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.bundles(id);


--
-- Name: orders orders_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: store_bundles store_bundles_bundle_id_bundles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_bundles
    ADD CONSTRAINT store_bundles_bundle_id_bundles_id_fk FOREIGN KEY (bundle_id) REFERENCES public.bundles(id) ON DELETE CASCADE;


--
-- Name: store_bundles store_bundles_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_bundles
    ADD CONSTRAINT store_bundles_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_orders store_orders_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_orders
    ADD CONSTRAINT store_orders_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_withdrawals store_withdrawals_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_withdrawals
    ADD CONSTRAINT store_withdrawals_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: stores stores_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wallet_ledger wallet_ledger_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_ledger
    ADD CONSTRAINT wallet_ledger_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wallets wallets_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict DGHkgIwKTrRfVytd8volmO5fDQB5nybGtIUvbZPUnvOYalPc2aor6cZOvGZhsjv

