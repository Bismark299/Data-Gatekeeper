import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import bundlesRouter from "./bundles";
import ordersRouter from "./orders";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(bundlesRouter);
router.use(ordersRouter);
router.use(adminRouter);

export default router;
