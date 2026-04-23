import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import bundlesRouter from "./bundles";
import ordersRouter from "./orders";
import adminRouter from "./admin";
import { walletRouter } from "./wallet";
import { cartRouter } from "./cart";
import { storesRouter } from "./stores";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(bundlesRouter);
router.use(ordersRouter);
router.use(adminRouter);
router.use("/wallet", walletRouter);
router.use("/cart", cartRouter);
router.use(storesRouter);

export default router;
