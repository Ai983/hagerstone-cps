import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { Building2, CheckCircle } from "lucide-react";

const CATEGORIES = [
  "Cement", "Steel & TMT", "Electrical", "Plumbing", "Tiles & Flooring",
  "Paints", "Hardware", "Safety Equipment", "MEP", "HVAC", "Fire Fighting",
  "Civil Works", "Interiors", "Other",
];

const REGIONS = [
  "Delhi NCR", "Mumbai", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Pan India", "Other",
];

export default function VendorRegister() {
  const navigate = useNavigate();

  const [companyName, setCompanyName] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [yearsInBusiness, setYearsInBusiness] = useState<number | "">("");

  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  const [addressText, setAddressText] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");

  const [categories, setCategories] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [businessDesc, setBusinessDesc] = useState("");
  const [referenceClients, setReferenceClients] = useState("");

  const [declaration, setDeclaration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [submittedId, setSubmittedId] = useState("");

  const toggleItem = (list: string[], item: string, setter: (v: string[]) => void) => {
    setter(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  };

  const handleSubmit = async () => {
    if (!companyName.trim()) { toast.error("Company name is required"); return; }
    if (!contactPerson.trim()) { toast.error("Contact person is required"); return; }
    if (!email.trim()) { toast.error("Email is required"); return; }
    if (!phone.trim()) { toast.error("Phone is required"); return; }
    if (!declaration) { toast.error("Please confirm the declaration"); return; }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.from("cps_vendor_registrations").insert([{
        company_name: companyName.trim(),
        gstin: gstin.trim() || null,
        pan: pan.trim() || null,
        contact_person: contactPerson.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        whatsapp: whatsapp.trim() || null,
        address_text: addressText.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        pincode: pincode.trim() || null,
        categories: categories.length ? categories : null,
        regions: regions.length ? regions : null,
        business_description: businessDesc.trim() || null,
        years_in_business: yearsInBusiness !== "" ? Number(yearsInBusiness) : null,
        reference_clients: referenceClients.trim() || null,
        status: "pending",
      }]).select("id").single();

      if (error) throw error;

      setSubmittedId(String((data as any).id).slice(0, 8).toUpperCase());
      setSubmittedEmail(email.trim().toLowerCase());
      setSubmitted(true);
      toast.success("Registration submitted successfully");
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit registration");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-lg w-full">
          <CardContent className="py-12 text-center space-y-4">
            <CheckCircle className="h-14 w-14 text-green-600 mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Registration Submitted Successfully!</h2>
            <p className="text-muted-foreground">Your application is under review.</p>
            <p className="text-sm text-muted-foreground">Reference: <span className="font-mono font-medium text-foreground">VR-{submittedId}</span></p>
            <p className="text-sm text-muted-foreground">We will review your application within 3 working days.</p>
            <p className="text-sm text-muted-foreground">To check your application status, use your email: <span className="font-medium text-foreground">{submittedEmail}</span></p>
            <Button onClick={() => navigate(`/vendor/status?email=${encodeURIComponent(submittedEmail)}`)}>
              Check Status
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto py-10 px-4 space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Hagerstone International (P) Ltd</h1>
          <h2 className="text-lg text-foreground">Vendor / Supplier Registration</h2>
          <p className="text-muted-foreground text-sm">Join our approved supplier network</p>
        </div>

        {/* Section 1 — Company Details */}
        <Card>
          <CardHeader><CardTitle className="text-base">Company Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 space-y-2">
              <Label>Company Name *</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>GSTIN</Label>
              <Input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="15-digit GSTIN" />
            </div>
            <div className="space-y-2">
              <Label>PAN</Label>
              <Input value={pan} onChange={(e) => setPan(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Years in Business</Label>
              <Input type="number" value={yearsInBusiness} onChange={(e) => setYearsInBusiness(e.target.value ? Number(e.target.value) : "")} />
            </div>
          </CardContent>
        </Card>

        {/* Section 2 — Contact Details */}
        <Card>
          <CardHeader><CardTitle className="text-base">Contact Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Contact Person Name *</Label>
              <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone *</Label>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>WhatsApp</Label>
              <Input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* Section 3 — Address */}
        <Card>
          <CardHeader><CardTitle className="text-base">Address</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 space-y-2">
              <Label>Address</Label>
              <Textarea rows={2} value={addressText} onChange={(e) => setAddressText(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Pincode</Label>
              <Input value={pincode} onChange={(e) => setPincode(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* Section 4 — Business Profile */}
        <Card>
          <CardHeader><CardTitle className="text-base">Business Profile</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Categories</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {CATEGORIES.map((cat) => (
                  <label key={cat} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={categories.includes(cat)}
                      onCheckedChange={() => toggleItem(categories, cat, setCategories)}
                    />
                    {cat}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Regions</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {REGIONS.map((reg) => (
                  <label key={reg} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={regions.includes(reg)}
                      onCheckedChange={() => toggleItem(regions, reg, setRegions)}
                    />
                    {reg}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Business Description <span className="text-muted-foreground text-xs ml-1">({businessDesc.length}/300)</span></Label>
              <Textarea
                rows={3}
                maxLength={300}
                value={businessDesc}
                onChange={(e) => setBusinessDesc(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Reference Clients</Label>
              <Textarea rows={2} value={referenceClients} onChange={(e) => setReferenceClients(e.target.value)} placeholder="List 2-3 past clients" />
            </div>
          </CardContent>
        </Card>

        {/* Section 5 — Declaration */}
        <Card>
          <CardContent className="py-6 space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={declaration} onCheckedChange={(v) => setDeclaration(Boolean(v))} className="mt-0.5" />
              <span className="text-sm">I confirm all information provided is accurate and complete</span>
            </label>
            <Button className="w-full" size="lg" onClick={handleSubmit} disabled={submitting || !declaration}>
              {submitting ? "Submitting..." : "Submit Registration"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
