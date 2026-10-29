import { Purchases } from '@revenuecat/purchases-capacitor';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { SocialLogin } from '@capgo/capacitor-social-login';
window.CashbookNative = { Purchases, Filesystem, Share, App, SocialLogin };
