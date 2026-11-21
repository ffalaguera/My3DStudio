import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

/**
 * Privacidad y términos. BORRADORES: los datos entre corchetes los rellena el titular y un abogado
 * debe revisarlos antes del lanzamiento (replica/launch/launch-plan.md, «Antes de abrir»).
 */
interface Section { h: string; p: string[] }

const PRIVACY: Section[] = [
  { h: 'Quién trata tus datos', p: [
    'El responsable es [NOMBRE O RAZÓN SOCIAL], con NIF [NIF] y domicilio en [DIRECCIÓN]. Contacto: [EMAIL DE PRIVACIDAD].',
  ] },
  { h: 'Qué datos tratamos y para qué', p: [
    'Cuenta: tu email y, si entras con Google, tu nombre y foto de perfil. Sirven para identificarte y darte acceso.',
    'Contenido: las imágenes y textos que subes y los modelos 3D que generas. Sirven para prestarte el servicio.',
    'Pagos: los gestiona Stripe. Nosotros no vemos ni guardamos los datos de tu tarjeta; solo el estado de tu suscripción.',
    'Uso técnico: registros de errores y de seguridad, necesarios para que el servicio funcione y para evitar abusos.',
  ] },
  { h: 'Base legal', p: [
    'La ejecución del contrato que aceptas al registrarte (art. 6.1.b RGPD) y nuestro interés legítimo en la seguridad del servicio (art. 6.1.f).',
  ] },
  { h: 'Con quién los compartimos', p: [
    'Proveedores que nos prestan servicios, con contrato de encargo de tratamiento: Supabase (cuenta y base de datos, UE), Cloudflare R2 (archivos), Stripe (pagos), Resend (emails) y fal.ai (generación de modelos).',
    'Algunos están en Estados Unidos; las transferencias se amparan en las Cláusulas Contractuales Tipo de la Comisión Europea o en el Marco de Privacidad de Datos UE-EE. UU. [REVISAR CON ABOGADO].',
    'No vendemos tus datos ni los usamos para entrenar modelos de IA.',
  ] },
  { h: 'Cuánto tiempo', p: [
    'Mientras tengas la cuenta. Si la borras, eliminamos tus datos y archivos, salvo lo que la ley nos obligue a conservar (por ejemplo, facturas).',
  ] },
  { h: 'Tus derechos', p: [
    'Puedes acceder, rectificar, suprimir, oponerte, limitar el tratamiento y llevarte tus datos escribiendo a [EMAIL DE PRIVACIDAD]. También puedes borrar tu cuenta desde Tu cuenta.',
    'Si crees que no hemos atendido bien tu solicitud, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).',
  ] },
];

const TERMS: Section[] = [
  { h: 'El servicio', p: [
    'My3DStudio genera modelos 3D a partir de imágenes o texto con inteligencia artificial. Lo presta [NOMBRE O RAZÓN SOCIAL], con NIF [NIF].',
    'Los resultados los genera una IA y pueden contener errores. Revísalos antes de usarlos en algo importante.',
  ] },
  { h: 'Créditos y precios', p: [
    'Cada generación gasta los créditos que se muestran antes de empezar. Si la generación falla o la cancelas, los créditos se devuelven.',
    'Los créditos del plan que no gastes pasan al mes siguiente, como mucho los de un mes. Los créditos de los packs no caducan mientras la cuenta exista.',
    'Te avisaremos con al menos 30 días de antelación antes de cambiar precios o costes en créditos.',
  ] },
  { h: 'Suscripciones y cancelación', p: [
    'Las suscripciones se renuevan solas al final de cada periodo. Puedes cancelar cuando quieras desde Tu cuenta; seguirás con tu plan hasta el final del periodo pagado.',
    'Derecho de desistimiento: [REVISAR CON ABOGADO: 14 días para consumidores en la UE y sus excepciones para contenido digital ya suministrado].',
  ] },
  { h: 'Tu contenido', p: [
    'Solo puedes subir imágenes sobre las que tengas derechos. No puedes subir contenido ilegal, de odio, sexual con menores ni que vulnere derechos de terceros.',
    'Los modelos que generes son tuyos. En el plan Gratis son públicos y de uso no comercial; en los planes de pago puedes hacerlos privados y usarlos comercialmente.',
    'Nos das permiso para guardar y procesar tu contenido solo para prestarte el servicio.',
  ] },
  { h: 'Responsabilidad', p: [
    '[REVISAR CON ABOGADO: limitación de responsabilidad, disponibilidad del servicio, ley aplicable y tribunales competentes].',
  ] },
];

@Component({
  selector: 'app-legal',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-6">
      <h1 class="text-xl">{{ doc() === 'privacy' ? 'Política de privacidad' : 'Términos de uso' }}</h1>
      <p class="hint" role="note">Borrador pendiente de revisión legal. Última actualización: 21 de noviembre de 2026.</p>
      @for (s of sections(); track s.h) {
        <section class="flex flex-col gap-2">
          <h2 class="text-lg">{{ s.h }}</h2>
          @for (t of s.p; track t) { <p class="text-sm text-text-muted">{{ t }}</p> }
        </section>
      }
      <p class="text-sm"><a [routerLink]="doc() === 'privacy' ? '/terminos' : '/privacidad'" class="underline">
        {{ doc() === 'privacy' ? 'Términos de uso' : 'Política de privacidad' }}</a></p>
    </article>
  `,
})
export class Legal {
  private readonly route = inject(ActivatedRoute);
  protected readonly doc = toSignal(this.route.data.pipe(map((d) => d['doc'] as 'privacy' | 'terms')), { initialValue: 'privacy' as const });
  protected readonly sections = computed(() => (this.doc() === 'privacy' ? PRIVACY : TERMS));
}
